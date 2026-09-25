/**
 * Generate AI Content Async Lambda
 * Handles long-running AI content generation tasks triggered via SQS
 */

const UserApiKeyService = require('../services/userApiKeys/userApiKeyService');
const LLMService = require('../services/llm/llmService');
const ProfileService = require("../services/profileService/profileService")
const MessageService = require('../services/messageService/messageService')
const { REPORT_STATUS, MONGODB_COLLECTIONS, DEFAULT_MODELS, LLM_PROVIDERS } = require('../services/llm/config/llmConfig');
const { getModelConfig } = require('../services/llm/config/modelTokenConfig');
const { estimateMessagesTokenCount } = require('../services/llm/utils/tokenCounter');
const {
    developerInstructions,
    examinePostTextInstructions,
    commentGenerationInstructions,
    reactionGenerationInstructions,
    commentAndReactionInstructions,
    enrichDataSectionInstruction,
    conversationSectionInstruction,
    aiMessagesSectionInstruction,
    getGenderBasedMessagesSectionInstruction
} = require('./shared/contentPrompts');
const { processGenerateAiMessagesJob } = require('./shared/aiMessageGeneration');

const { JOB_TYPE_AUTOMATION_BOOLEAN, JOB_TYPE_GENERATE_COMMENT,
     JOB_TYPE_GENERATE_REACTION, JOB_TYPE_GENERATE_COMMENT_AND_REACTION, 
    JOB_TYPE_GENERATE_AI_MESSAGES, JOB_TYPE_GENERATE_GENDER_BASED_AI_CONTENT } = require('./shared/jobTypes');

/**
 * @param {object} jobData
 * @returns {boolean}
 */
function isGenerateAiMessagesJob(jobData) {
    return jobData?.job_type === JOB_TYPE_GENERATE_AI_MESSAGES;
}

/**
 * @param {object} jobData
 * @returns {boolean}
 */
function isAiQuickMessageRequest(jobData) {
    return jobData?.ai_quick_message === true;
}

/**
 * @param {object} jobData
 * @returns {boolean}
 */
function hasValidGenerateAiMessagesPayload(jobData) {
    const hasMessageData = jobData?.message_data && typeof jobData.message_data === 'object';
    const hasQuickMessage = isAiQuickMessageRequest(jobData)
        && String(jobData?.prompts?.user_prompt || '').trim();
    return Boolean(hasQuickMessage || hasMessageData);
}

/**
 * Extract a readable error message from various error shapes (OpenAI SDK, LLMService, generic).
 * @param {*} error - Error object, string, or API response
 * @returns {{ message: string, metadata?: object }}
 */
function getErrorMessageAndMetadata(error) {
    const result = { message: 'Unknown error occurred' };
    if (!error) return result;

    if (typeof error === 'string') {
        result.message = error;
        return result;
    }
    if (error?.message) {
        result.message = error.message;
    } else if (error?.error && typeof error.error === 'object' && error.error?.message) {
        result.message = error.error.message;
    } else if (error?.response?.data?.error?.message) {
        result.message = error.response.data.error.message;
    } else {
        try {
            result.message = String(error);
        } catch {
            result.message = 'Unknown error occurred';
        }
    }

    // Capture OpenAI-style error metadata for debugging
    result.metadata = result.metadata || {};
    const status = error?.status ?? error?.statusCode ?? error?.response?.status ?? error?.error?.code;
    const code = error?.code ?? error?.error?.code;
    const type = error?.type ?? error?.error?.type;
    if (status != null) result.metadata.error_status = status;
    if (code) result.metadata.error_code = code;
    if (type) result.metadata.error_type = type;
    if (error?.llmMetadata && typeof error.llmMetadata === 'object') {
        Object.assign(result.metadata, error.llmMetadata);
    }
    if (Object.keys(result.metadata).length === 0) delete result.metadata;
    return result;
}

/**
 * Update job status to ERROR in the database. Handles reconnection if db is null.
 * @param {string} jobId - Job ID
 * @param {*} error - Error to extract message from
 * @param {object|null} db - MongoDB collection or null
 */
async function updateJobStatusToError(jobId, error, db, user_id) {
    if (!jobId) return;
    const { message: errorMessage, metadata: errorMetadata } = getErrorMessageAndMetadata(error);

    // CRITICAL: fr-mongodb uses a GLOBAL collection variable. After LLMService.chat (which calls
    // getUserSettings -> getCollection for user_llm_api_keys), the global collection is switched.
    // Re-initialize to ai_generated_posts BEFORE updating so we write to the correct collection.
    const dbName = process.env.DATABASE_NAME || 'fr_ai';
    const dbConn = await UserApiKeyService.getCollection(dbName, MONGODB_COLLECTIONS.AI_GENERATED_POSTS);

    const updatePayload = {
        status: REPORT_STATUS.ERROR,
        error: errorMessage,
        error_acknowledged: false,
        updated_at: new Date().toISOString().slice(0, 19).replace('T', ' ')
    };
    if (errorMetadata && Object.keys(errorMetadata).length > 0) {
        updatePayload.error_metadata = errorMetadata;
    }

    await dbConn.updateByQuery({ job_id: jobId }, { $set: updatePayload });
    console.log(`Job ${jobId} status updated to ERROR: ${errorMessage}`);

    if (user_id) {
            const aiErrorsDb = await UserApiKeyService.getCollection(dbName, MONGODB_COLLECTIONS.AI_ERRORS);
            const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
            const existingError = await aiErrorsDb.findOne({ user_id: user_id });
            
            if (existingError) {
                await aiErrorsDb.updateByQuery(
                    { user_id: user_id },
                    {
                        $set: {
                            error_message: errorMessage,
                            acknowledge: false,
                            updated_at: now
                        }
                    }
                );
            } else {
                await aiErrorsDb.insertOne({
                    user_id: user_id,
                    error_message: errorMessage,
                    acknowledge: false,
                    created_at: now,
                    updated_at: now
                });
            }
    }
}

/**
 * Lambda handler for async AI content generation
 * @param {Object} event - SQS event containing Records
 */
exports.handler = async (event) => {
    console.log('Async AI Content Generation Task Triggered', JSON.stringify(event));

    // Process each record from SQS
    for (const record of event.Records || []) {
        let jobData;
        try {
            jobData = typeof record.body === 'string' ? JSON.parse(record.body) : record.body;
            console.log('Processing job data:', JSON.stringify(jobData));
        } catch (parseError) {
            console.error('Failed to parse   record body:', record.body, parseError);
            continue;
        }

        const { job_id, user_id, friendFbId, fb_user_id, model, provider, prompts = {}, options = {}, post_text, job_type, comments } = jobData;

        const isAiMessagesJob = isGenerateAiMessagesJob(jobData);
        const isReactionJob = job_type === 'generate_reaction';
        const hasRequiredPrompt = prompts?.user_prompt || isReactionJob || isAiMessagesJob;

        if (!job_id || !user_id || !model || !hasRequiredPrompt) {
            console.error('Missing required parameters in job data:', jobData);
            // Update job to ERROR if job_id exists (prevents jobs stuck in PENDING)
            if (job_id) {
                try {
                    const missing = [];
                    if (!user_id) missing.push('user_id');
                    if (!model) missing.push('model');
                    if (isAiMessagesJob && !hasValidGenerateAiMessagesPayload(jobData)) {
                        missing.push('ai_quick_message or message_data');
                    } else if (!hasRequiredPrompt) {
                        missing.push('prompts.user_prompt');
                    }
                    await updateJobStatusToError(job_id, `Missing required parameters: ${missing.join(', ')}`, null);
                } catch (updateErr) {
                    console.error(`Failed to update error status for job ${job_id} (missing params):`, updateErr);
                }
            }
            continue;
        }

        if (isAiMessagesJob && !hasValidGenerateAiMessagesPayload(jobData)) {
            console.error('Invalid generate_ai_messages payload:', jobData);
            try {
                await updateJobStatusToError(
                    job_id,
                    'generate_ai_messages requires ai_quick_message or message_data',
                    null
                );
            } catch (updateErr) {
                console.error(`Failed to update error status for job ${job_id}:`, updateErr);
            }
            continue;
        }

        let db;
        let reportDb;
        try {
            // 1. Initialize MongoDB connection (same db/collection as handler: fr_ai.ai_generated_posts)
            const dbName = process.env.DATABASE_NAME || 'fr_ai';
            db = await UserApiKeyService.getCollection(
                dbName,
                MONGODB_COLLECTIONS.AI_GENERATED_POSTS
            );
            console.log(`Async job ${job_id}: using ${dbName}.${MONGODB_COLLECTIONS.AI_GENERATED_POSTS}`);

            // 2. Update status to PROCESSING
            await db.updateByQuery(
                { job_id },
                {
                    $set: {
                        status: REPORT_STATUS.PROCESSING,
                        updated_at: new Date().toISOString().slice(0, 19).replace("T", " ")
                    }
                }
            );

            console.log(`Job ${job_id} status updated to PROCESSING`);

            if (isAiMessagesJob) {
                console.log(`Job ${job_id}: processing generate_ai_messages (${isAiQuickMessageRequest(jobData) ? 'ai_quick_message' : 'message_data'})`);
                const aiMessageResult = await processGenerateAiMessagesJob(jobData);

                const updateData = {
                    status: REPORT_STATUS.COMPLETED,
                    content: {
                        generated_text: aiMessageResult.generatedText,
                        tokens_used: aiMessageResult.tokensUsed,
                        finish_reason: aiMessageResult.finishReason
                    },
                    metadata: aiMessageResult.metadata || {},
                    updated_at: new Date().toISOString().slice(0, 19).replace('T', ' ')
                };

                const dbForAiMessageUpdate = await UserApiKeyService.getCollection(dbName, MONGODB_COLLECTIONS.AI_GENERATED_POSTS);
                await dbForAiMessageUpdate.updateByQuery({ job_id }, { $set: updateData });
                console.log(`Job ${job_id} completed successfully (generate_ai_messages)`);
                continue;
            }

            // 3. Use model string directly from payload (fallback to provider default)
            const providerConfig = DEFAULT_MODELS[provider];
            const modelName = model || providerConfig?.CHAT || 'gpt-4o';

            const { system_prompt, user_prompt } = prompts;
            let instructionSet = developerInstructions;
            if (jobData.job_type === JOB_TYPE_AUTOMATION_BOOLEAN) instructionSet = examinePostTextInstructions;
            else if (jobData.job_type === JOB_TYPE_GENERATE_COMMENT) instructionSet = commentGenerationInstructions;
            else if (jobData.job_type === JOB_TYPE_GENERATE_REACTION) instructionSet = reactionGenerationInstructions;
            else if (jobData.job_type === JOB_TYPE_GENERATE_COMMENT_AND_REACTION) instructionSet = commentAndReactionInstructions;
            else if (jobData.job_type === JOB_TYPE_GENERATE_GENDER_BASED_AI_CONTENT) {
                instructionSet = getGenderBasedMessagesSectionInstruction(jobData.gender_based ?? jobData.gender);
            }

            const postTextForAi = typeof post_text === 'string' && post_text.trim() ? post_text.trim() : null;
            let effectiveUserPrompt = postTextForAi
                ? `user_prompt:\n ${user_prompt}\n\npost_text:\n${postTextForAi}`
                : user_prompt;
            let effectiveSystemPrompt = system_prompt;

            // check here if voice_bible is present as a merge field. if yes then search in the db if it is already generated if yes the replace it with the value else donot.
            const hasVoiceBiblePlaceholder = (text) =>
                text && (String(text).includes("{{voice_bible}}") || String(text).includes("{voice_bible}"));

            if (
                hasVoiceBiblePlaceholder(effectiveUserPrompt) ||
                hasVoiceBiblePlaceholder(effectiveSystemPrompt)
            ) {
                reportDb = await UserApiKeyService.getCollection(
                    process.env.DATABASE_NAME || 'fr_ai',
                    MONGODB_COLLECTIONS.AI_REPORTS
                );

                // Fetch latest completed voice bible only once
                const voiceBible = await reportDb.aggregate([
                    {
                        $match: {
                            user_id,
                            framework_id: 1,
                            status: REPORT_STATUS.COMPLETED
                        }
                    },
                    { $sort: { created_at: -1 } },
                    { $limit: 1 }
                ]);

                const report =
                    voiceBible?.[0]?.report_content?.data?.report;

                if (report) {
                    const reportValue = JSON.stringify(report, null, 2);

                    const voiceBibleSection = `
                    ## VOICE BIBLE
                    The following JSON contains the writing style, tone, personality, vocabulary, formatting preferences, and behavioral patterns that MUST be followed while generating the response.

                    VOICE_BIBLE_DATA:
                    ${reportValue}

                    ## END VOICE BIBLE
                    `;

                    const voiceBibleRegex =
                        /\{\{voice_bible\}\}|\{voice_bible\}/g;

                    if (hasVoiceBiblePlaceholder(effectiveUserPrompt)) {
                        effectiveUserPrompt = effectiveUserPrompt.replace(
                            voiceBibleRegex,
                            voiceBibleSection
                        );
                    }

                    if (hasVoiceBiblePlaceholder(effectiveSystemPrompt)) {
                        effectiveSystemPrompt = effectiveSystemPrompt.replace(
                            voiceBibleRegex,
                            voiceBibleSection
                        );
                    }
                }
            }

            const hasEnrichedData =
                (
                    String(effectiveUserPrompt).includes("{{enriched_data}}") ||
                    String(effectiveUserPrompt).includes("{enriched_data}") ||
                    String(effectiveSystemPrompt).includes("{{enriched_data}}") ||
                    String(effectiveSystemPrompt).includes("{enriched_data}")
                );

            const hasMessageHistory =
                (
                    String(effectiveUserPrompt).includes("{{message_history}}") ||
                    String(effectiveUserPrompt).includes("{message_history}") ||
                    String(effectiveSystemPrompt).includes("{{message_history}}") ||
                    String(effectiveSystemPrompt).includes("{message_history}")
                );


            // check here if enrich_data is present as a merge field. if yes then search in the db if it is already generated if yes the replace it with the value else donot.
           if (hasEnrichedData){

                friendDb = await ProfileService.getCollection(
                    'fr_profile',
                    MONGODB_COLLECTIONS.FRIEND_LISTS
                );

                // Query: Get enrich data
                const friendData = await friendDb.aggregate([
                    {
                        $match: {
                            user_id,
                            fb_user_id,
                            friendFbId
                        }
                    },
                    {
                        $project: {
                            enrich_data: 1
                        }
                    }
                ]);

                if (friendData[0]?.enrich_data) {

                    const enrichDataValue = JSON.stringify(
                        friendData[0].enrich_data,
                        null,
                        2
                    );

                    const enrichDataSection = enrichDataSectionInstruction;

                    instructionSet = enrichDataSection;

                    let enrichData =
                        "ENRICHED USER DATA STARTS FROM HERE\n" +
                        enrichDataValue+
                        "\nENRICHED USER DATA ENDS FROM HERE";

                    const enrichDataRegex =
                        /\{\{enriched_data\}\}|\{enriched_data\}/g;

                    if (
                        String(effectiveUserPrompt).includes("{{enriched_data}}") ||
                        String(effectiveUserPrompt).includes("{enriched_data}")
                    ) {
                        effectiveUserPrompt = effectiveUserPrompt.replace(
                            enrichDataRegex,
                            enrichData
                        );
                    }

                    if (
                        String(effectiveSystemPrompt).includes("{{enriched_data}}") ||
                        String(effectiveSystemPrompt).includes("{enriched_data}")
                    ) {
                        effectiveSystemPrompt = effectiveSystemPrompt.replace(
                            enrichDataRegex,
                            enrichData
                        );
                    }
                }
            }

            // check here if  is present as a merge field. if yes then search in the db if it is already generated if yes the replace it with the value else donot.
            if (hasMessageHistory) {
                let messageDb = await MessageService.getCollection(
                    'fr_messages',
                    MONGODB_COLLECTIONS.CHAT_DATA
                );

                // Query 1: Get the message history data
                const chatData = await messageDb.aggregate([{
                        $match: {
                            user_id,
                            fb_user_id,
                            friendFbId
                        }
                    },
                    {
                        $project: {
                            messages: 1
                        }
                    }
                ]);

                let formattedChat = [];

                if (chatData[0]?.messages?.length) {

                    formattedChat = chatData[0].messages
                        .filter(msg =>
                            msg.type === "text" &&
                            msg.text &&
                            msg.text.trim().length > 0
                        )
                        .map(msg => ({
                            sender: msg.sender_fb_id === fb_user_id
                                ? "account_holder"
                                : "other_person",

                            content: msg.text
                        }));
                }

                if (formattedChat.length) {

                    const conversationDataValue = JSON.stringify(
                        formattedChat,
                        null,
                        2
                    );

                    const conversationInstruction = conversationSectionInstruction
                    
                    instructionSet = conversationInstruction

                    let conversationData = "CONVERSATION DATA STARTS FROM HERE" +
                        JSON.stringify(
                            formattedChat,
                            null,
                            2
                        ); + 
                    "CONVERSATION DATA ENDS FROM HERE"

                    const conversationRegex =
                        /\{\{message_history\}\}|\{message_history\}/g;

                    if (
                        effectiveUserPrompt &&
                        (
                            String(effectiveUserPrompt).includes("{{message_history}}") ||
                            String(effectiveUserPrompt).includes("{message_history}")
                        )
                    ) {
                        effectiveUserPrompt = effectiveUserPrompt.replace(
                            conversationRegex,
                            conversationData
                        );
                    }

                    if (
                        effectiveSystemPrompt &&
                        (
                            String(effectiveSystemPrompt).includes("{{message_history}}") ||
                            String(effectiveSystemPrompt).includes("{message_history}")
                        )
                    ) {
                        effectiveSystemPrompt = effectiveSystemPrompt.replace(
                            conversationRegex,
                            conversationData
                        );
                    }
                }

            }

            if(hasEnrichedData && hasMessageHistory){
                instructionSet = enrichDataSectionInstruction + conversationSectionInstruction
            }

            if(job_type == "generate_reaction"){ 
                effectiveUserPrompt = [
                    postTextForAi ? `post_text:\n${postTextForAi}` : null 
                ]
                .filter(Boolean)
                .join("\n\n");  
            }
            
            if (job_type == "generate_comment_and_reaction" || job_type == "generate_comment") {
                const hasPostToken = user_prompt && String(user_prompt).includes("{{post}}");
                const hasCommentsToken = user_prompt && String(user_prompt).includes("{{comments}}");

                const commentsForMerge =
                    comments == null || comments === ""
                        ? "[]"
                        : typeof comments === "string"
                          ? comments
                          : "comments:" + JSON.stringify(comments);

                if (hasPostToken || hasCommentsToken) {
                    let resolved = user_prompt || "";
                    if (hasPostToken) {
                        resolved = resolved.split("{{post}}").join("post text :\n" + postTextForAi ?? "");
                    }
                    if (hasCommentsToken) {
                        resolved = resolved.split("{{comments}}").join("comments :\n" + commentsForMerge);
                    }
                    effectiveUserPrompt = resolved;
                } else {
                    effectiveUserPrompt = user_prompt || "";
                }

                console.log(`[Prompt Debug] job_id: ${job_id} | job_type: ${job_type}`);
                console.log(`[Prompt Debug] effectiveUserPrompt:\n${effectiveUserPrompt}`);
            }

            let messages = [
                { role: 'system', content: instructionSet },
                ...(system_prompt ? [{ role: 'system', content: system_prompt }] : []),
                { role: 'user', content: effectiveUserPrompt }
            ];

            console.log(`Effective system prompt:  ${system_prompt}`);
            console.log(`Effective user prompt: ${effectiveUserPrompt}`);
            console.log(`Instruction set: ${instructionSet}`);
            
            const llmOptions = {
                ...options,
                model: modelName
            };

            if (!llmOptions.maxTokens || llmOptions.maxTokens <= 0) {
                const modelConfig = getModelConfig(modelName);
                const estimatedInputTokens = estimateMessagesTokenCount(messages);

                console.log(`[Token Calc] Model: ${modelName}, Input: ~${estimatedInputTokens} tokens`);

                let availableTokens = modelConfig.contextWindow - estimatedInputTokens;

                if (modelConfig.isReasoningModel && modelConfig.reasoningTokenBuffer) {
                    availableTokens -= modelConfig.reasoningTokenBuffer;
                    console.log(`[Token Calc] Reasoning model: reserved ${modelConfig.reasoningTokenBuffer} tokens for thinking`);
                }

                const safeOutputTokens = Math.floor(availableTokens * modelConfig.safeOutputRatio);
                let calculatedTokens = Math.min(safeOutputTokens, modelConfig.maxOutputTokens);
                calculatedTokens = Math.max(calculatedTokens, modelConfig.minOutputTokens);

                if (estimatedInputTokens + calculatedTokens > modelConfig.contextWindow) {
                    console.warn(`[Token Calc] Input too large, reducing output tokens`);
                    calculatedTokens = Math.max(
                        modelConfig.contextWindow - estimatedInputTokens - 100,
                        modelConfig.minOutputTokens
                    );
                }

                console.log(`[Token Calc] Calculated maxTokens: ${calculatedTokens} (${Math.round(calculatedTokens/modelConfig.maxOutputTokens*100)}% of max)`);
                llmOptions.maxTokens = calculatedTokens;
            } else {
                const modelConfig = getModelConfig(modelName);
                const requestedTokens = llmOptions.maxTokens;

                if (requestedTokens > modelConfig.maxOutputTokens) {
                    console.log(`[Token Calc] Requested ${requestedTokens} exceeds model max ${modelConfig.maxOutputTokens}, capping`);
                    llmOptions.maxTokens = modelConfig.maxOutputTokens;
                }

                if (requestedTokens < modelConfig.minOutputTokens) {
                    console.log(`[Token Calc] Requested ${requestedTokens} below minimum ${modelConfig.minOutputTokens}, raising`);
                    llmOptions.maxTokens = modelConfig.minOutputTokens;
                }
            }

            console.log(`Calling LLM chat API for job ${job_id}${system_prompt ? ' (with caller system prompt)' : ''}`);
            console.log(`Using maxTokens: ${llmOptions.maxTokens}`);
            if (job_type === "generate_comment" || job_type === "generate_comment_and_reaction") {
                console.log(`[LLM Payload Debug] job_id: ${job_id} | messages:`, JSON.stringify(messages, null, 2));
            }
            const result = await LLMService.chat({
                user_id,
                messages,
                provider,
                options: llmOptions
            });

            console.log('LLM Service result:', JSON.stringify(result));

            if (!result || typeof result !== 'object') {
                throw new Error(result ? String(result) : 'LLM service returned invalid response');
            }
            if (result?.success) {
                let generatedText = (result.content ?? result.response ?? result.message?.content ?? '').trim()
                    .replaceAll('{{friendNameToken}}', '{{friendName}}')
                    .replaceAll('{{friendShortNameToken}}', '{{friendShortName}}')
                    .replaceAll('{{friendGenderToken}}', '{{friendGender}}')
                    .replaceAll('{{countryToken}}', '{{country}}')
                    .replaceAll('{{tierToken}}', '{{tier}}');

                const usage = result.metadata?.usage;
                const tokensUsed = result.metadata?.tokensUsed ?? usage?.total_tokens ?? usage?.completion_tokens ?? 0;
                const finishReason = result.metadata?.finishReason ?? result.metadata?.finish_reason ?? 'stop';

                if (!generatedText || generatedText.trim().length === 0) {
                    throw new Error(`LLM returned empty content (finish_reason: ${finishReason}, tokens: ${tokensUsed}). This is likely due to truncation or model error.`);
                }
                if(job_type == "generate_comment_and_reaction"){
                    generatedText = JSON.parse(generatedText);
                }

                if (finishReason === 'length') {
                    console.warn(`[Truncation Warning] Job ${job_id}: finish_reason is 'length'; content may be incomplete. Tokens used: ${tokensUsed}. Content length: ${generatedText.length} chars`);
                }

                const updateData = {
                    status: REPORT_STATUS.COMPLETED,
                    content: {
                        generated_text: generatedText,
                        tokens_used: tokensUsed,
                        finish_reason: finishReason
                    },
                    metadata: result.metadata || {},
                    updated_at: new Date().toISOString().slice(0, 19).replace("T", " ")
                };

                const dbForUpdate = await UserApiKeyService.getCollection(dbName, MONGODB_COLLECTIONS.AI_GENERATED_POSTS);
                await dbForUpdate.updateByQuery(
                    { job_id },
                    { $set: updateData }
                );

                console.log(`Job ${job_id} completed successfully`);
            } else {
                const errMsg = typeof result.error === 'string' ? result.error
                    : (result.error?.message ?? (result.error ? JSON.stringify(result.error) : null))
                    ?? 'LLM service returned unsuccessful result';
                const err = new Error(errMsg);
                if (result.metadata) err.llmMetadata = result.metadata;
                throw err;
            }

        } catch (error) {
            console.error(`Error processing job ${job_id}:`, error);

            // Always update job status to ERROR for any exception (OpenAI errors, LLM failures, DB issues, etc.)
            try {
                await updateJobStatusToError(job_id, error, db, user_id);
            } catch (dbError) {
                console.error(`Failed to update error status for job ${job_id}:`, dbError);
            }
        }
    }

    return {
        statusCode: 200,
        body: JSON.stringify({ message: 'Batch processing completed' })
    };
};