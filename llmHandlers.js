/**
 * LLM Handlers
 * Request handlers for LLM API endpoints
 */

const { v4: uuidv4 } = require('uuid');
const AWS = require('aws-sdk');
const { Response } = require('../../libs');
const LLMService = require('../services/llm/llmService');
const UserApiKeyService = require('../services/userApiKeys/userApiKeyService');
const AutomationService = require('../services/llm/automationService/automationService');
const LLMFactory = require('../services/llm/llmFactory');
const { ANALYSIS_TYPES, MONGODB_COLLECTIONS, REPORT_STATUS, LLM_PROVIDERS, DEFAULT_MODELS } = require('../services/llm/config/llmConfig');
const { getModelsForProvider } = require('../services/llm/config/modelsConfig');
const { REACTION_TYPES } = require('../asyncLambdas/shared/reactionTypes');
const { resolveSpintax } = require('../utils/sprintText');

// const JOB_TYPE_AUTOMATION_BOOLEAN = 'examine_post_text';
// const JOB_TYPE_GENERATE_COMMENT = 'generate_comment';
// const JOB_TYPE_GENERATE_REACTION = 'generate_reaction';
// const JOB_TYPE_GENERATE_COMMENT_AND_REACTION = 'generate_comment_and_reaction';
// const JOB_TYPE_GENERATE_AI_MESSAGES = 'generate_ai_messages';
// const JOB_TYPE_GENERATE_GENDER_BASED_AI_CONTENT = 'generate_gender_based_ai_content';

const { JOB_TYPE_AUTOMATION_BOOLEAN, JOB_TYPE_GENERATE_COMMENT, JOB_TYPE_GENERATE_REACTION, JOB_TYPE_GENERATE_COMMENT_AND_REACTION, 
    JOB_TYPE_GENERATE_AI_MESSAGES, JOB_TYPE_GENERATE_GENDER_BASED_AI_CONTENT } = require('../asyncLambdas/shared/jobTypes');

const getuser_idFromAuth = (event) => {
    const auth = event.requestContext?.authorizer || {};
    const user_id = Number(auth.id) || Number(auth.claims?.id);
    return user_id || null;
};

const buildLlmOptions = (isAdvSettings, options = {}, baseOptions = {}) => {
    let llmOptions = { ...baseOptions };
    if (isAdvSettings && options) {
        if (options.temperature !== undefined) llmOptions.temperature = options.temperature;
        if (options.presence_penalty !== undefined) llmOptions.presencePenalty = options.presence_penalty;
        if (options.frequency_penalty !== undefined) llmOptions.frequencyPenalty = options.frequency_penalty;
        if (options.maximumLength !== undefined) llmOptions.maxTokens = options.maximumLength;
    }
    return llmOptions;
};

/**
 * Generate content using LLM
 * POST /llm/generate
 */
const generateContent = async (event, context) => {
    try {
        const body = event.body || {};
        const { prompt, provider, options } = body;
        const user_id = getuser_idFromAuth(event);

        if (!user_id) {
            return Response.failure({ success: false, message: 'user_id is required' }, 400);
        }

        if (!prompt) {
            return Response.failure({ success: false, message: 'prompt is required' }, 400);
        }

        const result = await LLMService.generateContent({
            user_id,
            prompt,
            provider,
            options,
        });

        if (!result.success) {
            return Response.failure(result, 400);
        }

        return Response.success(result);
    } catch (error) {
        console.error('generateContent handler error:', error);
        return Response.failure({
            success: false,
            message: 'Failed to generate content',
            error: error.message,
        }, 500);
    }
};

/**
 * Analyze content using LLM
 * POST /llm/analyze
 */
const analyzeContent = async (event, context) => {
    try {
        const body = event.body || {};
        const { content, analysisType, provider, options } = body;
        const user_id = getuser_idFromAuth(event);

        if (!user_id) {
            return Response.failure({ success: false, message: 'user_id is required' }, 400);
        }

        if (!content) {
            return Response.failure({ success: false, message: 'content is required' }, 400);
        }

        if (!analysisType) {
            return Response.failure({ success: false, message: 'analysisType is required' }, 400);
        }

        // Validate analysis type
        const validTypes = Object.values(ANALYSIS_TYPES);
        if (!validTypes.includes(analysisType)) {
            return Response.failure({
                success: false,
                message: `Invalid analysisType. Valid types: ${validTypes.join(', ')}`,
            }, 400);
        }

        const result = await LLMService.analyzeContent({
            user_id,
            content,
            analysisType,
            provider,
            options,
        });

        if (!result.success) {
            return Response.failure(result, 400);
        }

        return Response.success(result);
    } catch (error) {
        console.error('analyzeContent handler error:', error);
        return Response.failure({
            success: false,
            message: 'Failed to analyze content',
            error: error.message,
        }, 500);
    }
};

/**
 * Chat completion using LLM
 * POST /llm/chat
 */
const chatCompletion = async (event, context) => {
    try {
        const body = event.body || {};
        const { messages, provider, options } = body;
        const user_id = getuser_idFromAuth(event);

        if (!user_id) {
            return Response.failure({ success: false, message: 'user_id is required' }, 400);
        }

        if (!messages || !Array.isArray(messages) || messages.length === 0) {
            return Response.failure({ success: false, message: 'messages array is required and must not be empty' }, 400);
        }

        const result = await LLMService.chat({
            user_id,
            messages,
            provider,
            options,
        });

        if (!result.success) {
            return Response.failure(result, 400);
        }

        return Response.success(result);
    } catch (error) {
        console.error('chatCompletion handler error:', error);
        return Response.failure({
            success: false,
            message: 'Failed to complete chat',
            error: error.message,
        }, 500);
    }
};

/**
 * Save or update user's API key
 * POST /llm/api-keys
 */
const saveApiKey = async (event, context) => {
    try {
        const body = event.body || {};
        const { provider, fb_user_id, apiKey, model, text_model, image_model, is_default, isActive } = body;
        const user_id = getuser_idFromAuth(event);

        if (!user_id) {
            return Response.failure({ success: false, message: 'user_id is required' }, 400);
        }

        if (!provider) {
            return Response.failure({ success: false, message: 'provider is required' }, 400);
        }

        if (!fb_user_id) {
            return Response.failure({ success: false, message: 'fb_user_id is required' }, 400);
        }

        // Validate provider
        if (!LLMFactory.isProviderSupported(provider)) {
            return Response.failure({
                success: false,
                message: `Unsupported provider. Supported providers: ${LLMFactory.getSupportedProviders().join(', ')}`,
            }, 400);
        }

        const result = await UserApiKeyService.saveApiKey(user_id, provider, apiKey, {
            model,
            text_model,
            image_model,
            is_default,
        }, isActive, fb_user_id);

        // If validation or save failed, return appropriate error status
        if (!result.success) {
            if (result.error === 'INVALID_API_KEY' || result.error === 'INVALID_PROVIDER') {
                return Response.failure(result, 400);
            }
            if (result.error === 'MISSING_INPUT' || result.error === 'API_KEY_REQUIRED') {
                return Response.failure(result, 400);
            }
            return Response.failure(result, 500);
        }

        return Response.success(result);
    } catch (error) {
        console.error('saveApiKey handler error:', error);
        return Response.failure({
            success: false,
            message: 'Failed to save API key',
            error: error.message,
        }, 500);
    }
};

/**
 * Get user's configured providers
 * GET /llm/api-keys
 */
const getUserProviders = async (event, context) => {
    try {
        const user_id = getuser_idFromAuth(event);

        if (!user_id) {
            return Response.failure({ success: false, message: 'user_id is required' }, 400);
        }

        const providers = await UserApiKeyService.getUserProviders(user_id);
        const defaultProvider = await UserApiKeyService.getDefaultProvider(user_id);
        return Response.success({
            success: true,
            user_id,
            providers,
            defaultProvider,
            supportedProviders: LLMFactory.getSupportedProviders(),
        });
    } catch (error) {
        console.error('getUserProviders handler error:', error);
        return Response.failure({
            success: false,
            message: 'Failed to get user providers',
            error: error.message,
        }, 500);
    }
};

/**
 * Delete user's API key for a provider
 * DELETE /llm/api-keys/{provider}
 */
const deleteApiKey = async (event, context) => {
    try {
        const provider = event.pathParameters?.provider;
        const user_id = getuser_idFromAuth(event);

        if (!user_id) {
            return Response.failure({ success: false, message: 'user_id is required' }, 400);
        }

        if (!provider) {
            return Response.failure({ success: false, message: 'provider path parameter is required' }, 400);
        }

        const result = await UserApiKeyService.deleteApiKey(user_id, provider);

        if (!result.success) {
            return Response.failure(result, 404);
        }

        return Response.success(result);
    } catch (error) {
        console.error('deleteApiKey handler error:', error);
        return Response.failure({
            success: false,
            message: 'Failed to delete API key',
            error: error.message,
        }, 500);
    }
};

/**
 * Generate content from framework + data
 * POST /llm/generate-from-framework
 * Body: { framework: string, data: object|array|string, provider?, options? }
 */
const generateFromFramework = async (event, context) => {
    try {
        const { framework_id, fb_user_id } = event.body || {};

        if (!fb_user_id) {
            return Response.failure({ success: false, message: 'fb_user_id is required' }, 400);
        }
        if (!framework_id) {
            return Response.failure({ success: false, message: 'framework_id is required' }, 400);
        }

        const user_id = getuser_idFromAuth(event);

        if (!user_id) {
            return Response.failure({ success: false, message: 'user_id is required' }, 400);
        }

        const defaultProviderInfo = await UserApiKeyService.getDefaultProvider(user_id);
        if (!defaultProviderInfo.provider) {
            return Response.failure({
                success: false,
                message: 'No AI provider configured. Please add an API key and set a default provider first.',
            }, 400);
        }

        const provider = defaultProviderInfo.provider;
        const text_model = defaultProviderInfo.text_model || null;

        let options = {};
        if (text_model) {
            options.model = text_model;
        }

        const db = await UserApiKeyService.getCollection(process.env.DATABASE_NAME || 'fr_ai', MONGODB_COLLECTIONS.AI_REPORTS);
        const isProcessing = await db.findOne({ user_id, fb_user_id, framework_id, status: { $nin: [REPORT_STATUS.COMPLETED, REPORT_STATUS.ERROR] } });
        if (isProcessing) {
            return Response.failure({ success: false, message: 'Please wait for the previous report to complete. ' }, 400);
        }

        const report_id = uuidv4();

        const report_payload = {
            user_id,
            fb_user_id,
            report_id,
            framework_id,
            status: REPORT_STATUS.PENDING,
            provider,
            options,
            created_at: new Date().toISOString().slice(0, 19).replace("T", " "),
            updated_at: new Date().toISOString().slice(0, 19).replace("T", " ")
        };

        await db.insertOne(report_payload);

        const sqs = new AWS.SQS();
        const queueUrl = process.env.REPORT_QUEUE_URL;

        if (!queueUrl) {
            throw new Error('REPORT_QUEUE_URL environment variable is not defined');
        }

        console.log(`Pushing to SQS queue: ${queueUrl} for report: ${report_id} provider: ${provider} model: ${text_model}`);

        const sqsParams = {
            MessageBody: JSON.stringify({
                user_id,
                fb_user_id,
                report_id,
                framework_id,
                provider,
                options
            }),
            QueueUrl: queueUrl
        };

        await sqs.sendMessage(sqsParams).promise();

        return Response.success({
            success: true,
            message: 'Report generation request pushed to queue',
            report_id,
            status: REPORT_STATUS.PENDING
        });
    } catch (error) {
        console.error('generateFromFramework handler error:', error);
        return Response.failure({
            success: false,
            message: 'Failed to initiate report generation',
            error: error.message,
        }, 500);
    }
};

/**
 * Validate user's API key
 * POST /llm/validate-key
 */
const validateApiKey = async (event, context) => {
    try {
        const body = event.body || {};
        const { provider } = body;
        const user_id = getuser_idFromAuth(event);

        if (!user_id) {
            return Response.failure({ success: false, message: 'user_id is required' }, 400);
        }

        const result = await LLMService.validateUserApiKey(user_id, provider);

        return Response.success(result);
    } catch (error) {
        console.error('validateApiKey handler error:', error);
        return Response.failure({
            success: false,
            message: 'Failed to validate API key',
            error: error.message,
        }, 500);
    }
};

/**
 * Get report status - returns latest completed report and any subsequent non-completed report
 * GET /llm/report-status?fb_user_id=xxx&framework_id=xxx
 */
const getReportStatus = async (event, context) => {
    try {
        const { fb_user_id, framework_id } = event.queryStringParameters || {};
        const user_id = getuser_idFromAuth(event);

        if (!user_id) {
            return Response.failure({ success: false, message: 'user_id is required' }, 400);
        }

        if (!fb_user_id) {
            return Response.failure({ success: false, message: 'fb_user_id query parameter is required' }, 400);
        }

        if (!framework_id) {
            return Response.failure({ success: false, message: 'framework_id query parameter is required' }, 400);
        }

        // Convert framework_id to number
        const frameworkIdNum = Number(framework_id);
        if (isNaN(frameworkIdNum)) {
            return Response.failure({ success: false, message: 'framework_id must be a valid number' }, 400);
        }

        // Get database connection
        const db = await UserApiKeyService.getCollection(
            process.env.DATABASE_NAME || 'fr_ai',
            MONGODB_COLLECTIONS.AI_REPORTS
        );

        // Query 1: Get latest completed report
        const completedReports = await db.aggregate([
            {
                $match: {
                    user_id,
                    fb_user_id,
                    framework_id: frameworkIdNum,
                    status: REPORT_STATUS.COMPLETED
                }
            },
            { $sort: { created_at: -1 } },
            { $limit: 1 }
        ]);

        const latestCompleted = completedReports && completedReports.length > 0 ? completedReports[0] : null;

        // Query 2: Get latest acknowledged error report (if any)
        // This helps us skip older errors that have been acknowledged
        const acknowledgedErrorReports = await db.aggregate([
            {
                $match: {
                    user_id,
                    fb_user_id,
                    framework_id: frameworkIdNum,
                    status: REPORT_STATUS.ERROR,
                    error_acknowledged: true
                }
            },
            { $sort: { created_at: -1 } },
            { $limit: 1 }
        ]);

        const latestAcknowledgedError = acknowledgedErrorReports && acknowledgedErrorReports.length > 0
            ? acknowledgedErrorReports[0]
            : null;

        // Query 3: Get subsequent non-completed report (excluding acknowledged errors)
        // If there's a completed report, get pending reports created after it
        // If there's no completed report (first-time generation), get any pending report
        // Always exclude reports before the latest acknowledged error (if any)
        const pendingMatchQuery = {
            user_id,
            fb_user_id,
            framework_id: frameworkIdNum,
            status: { $nin: [REPORT_STATUS.COMPLETED] },
            $or: [
                { error_acknowledged: { $ne: true } },
                { error_acknowledged: { $exists: false } }
            ]
        };

        // Build created_at condition: must be after both latestCompleted AND latestAcknowledgedError
        // We use the later of the two dates to ensure we only get reports after both
        const datesToCompare = [];
        if (latestCompleted) {
            datesToCompare.push(latestCompleted.created_at);
        }
        if (latestAcknowledgedError) {
            datesToCompare.push(latestAcknowledgedError.created_at);
        }

        if (datesToCompare.length > 0) {
            // Find the latest date - we want reports created after the most recent of these
            const latestDate = datesToCompare.reduce((latest, date) =>
                new Date(date) > new Date(latest) ? date : latest
            );
            pendingMatchQuery.created_at = { $gt: latestDate };
        }

        // Use aggregate for proper sorting (findOne doesn't support sort)
        const pendingReports = await db.aggregate([
            {
                $match: pendingMatchQuery
            },
            { $sort: { created_at: -1 } },
            { $limit: 1 }
        ]);

        const pendingReport = pendingReports && pendingReports.length > 0 ? pendingReports[0] : null;

        return Response.success({
            success: true,
            latest_completed: latestCompleted,
            pending_report: pendingReport
        });
    } catch (error) {
        console.error('getReportStatus handler error:', error);
        return Response.failure({
            success: false,
            message: 'Failed to get report status',
            error: error.message,
        }, 500);
    }
};

/**
 * Acknowledge report error - marks error as acknowledged so it won't appear in pending reports
 * PATCH /llm/report-status/{report_id}/acknowledge
 */
const acknowledgeReportError = async (event, context) => {
    try {
        const report_id = event.pathParameters?.report_id;
        const user_id = getuser_idFromAuth(event);

        if (!user_id) {
            return Response.failure({ success: false, message: 'user_id is required' }, 400);
        }

        if (!report_id) {
            return Response.failure({ success: false, message: 'report_id path parameter is required' }, 400);
        }

        // Get database connection
        const db = await UserApiKeyService.getCollection(
            process.env.DATABASE_NAME || 'fr_ai',
            MONGODB_COLLECTIONS.AI_REPORTS
        );

        // First, check if the report exists and belongs to the user
        const report = await db.findOne({ report_id, user_id });

        if (!report) {
            return Response.failure({
                success: false,
                message: 'Report not found or does not belong to this user'
            }, 404);
        }

        // Check if the report status is ERROR
        if (report.status !== REPORT_STATUS.ERROR) {
            return Response.failure({
                success: false,
                message: 'Can only acknowledge reports with error status'
            }, 400);
        }

        // Update the error_acknowledged field
        const updateResult = await db.updateByQuery(
            { report_id, user_id },
            {
                $set: {
                    error_acknowledged: true,
                    updated_at: new Date().toISOString().slice(0, 19).replace("T", " ")
                }
            }
        );

        return Response.success({
            success: true,
            message: 'Error acknowledged successfully',
            report_id
        });
    } catch (error) {
        console.error('acknowledgeReportError handler error:', error);
        return Response.failure({
            success: false,
            message: 'Failed to acknowledge error',
            error: error.message,
        }, 500);
    }
};

/**
 * Generate AI content asynchronously
 * POST /llm/generate/ai-content
 * Body: { system_prompt?, user_prompt, model, provider?, isAdvSettings?, options? }
 */
const generateAiContent = async (event, context) => {
    try {
        const body = event.body || {};
        const {
            system_prompt,
            user_prompt,
            friendFbId,
            fb_user_id,
            model,
            provider = 'openai',
            isAdvSettings = false,
            options = {},
            job_type,
            message_data,
            ai_quick_message,
            segments,
            gender,
        } = body;

        const user_id = getuser_idFromAuth(event);

        if (!user_id) {
            return Response.failure({ success: false, message: 'user_id is required' }, 400);
        }

        if (typeof user_prompt !== 'string' && job_type !== 'generate_ai_messages') {
            return Response.failure({ success: false, message: 'user_prompt must be a single string' }, 400);
        }

        if (job_type === 'generate_ai_messages' || job_type === 'generate_gender_based_ai_content') {
            if (ai_quick_message === true) {
                if (!user_prompt || typeof user_prompt !== 'string' || !user_prompt.trim()) {
                    return Response.failure({
                        success: false,
                        message: 'user_prompt is required when ai_quick_message is true'
                    }, 400);
                }
            } else if (!message_data || typeof message_data !== 'object') {
                return Response.failure({
                    success: false,
                    message: 'message_data is required when ai_quick_message is not true'
                }, 400);
            }
        }
        const userPromptTrimmed = user_prompt?.trim();

        // Spintax `{ a | b | c }` in that single text: pick one option per block at random
        const resolvedUserPrompt = resolveSpintax(userPromptTrimmed);

        if (!model || typeof model !== 'string' || !model.trim()) {
            return Response.failure({ success: false, message: 'model is required (model name string)' }, 400);
        }

        // Validate provider
        const validProviders = Object.values(LLM_PROVIDERS);
        if (!validProviders.includes(provider)) {
            return Response.failure({
                success: false,
                message: `Invalid provider. Valid providers: ${validProviders.join(', ')}`,
            }, 400);
        }

        // Get database connection
        const db = await UserApiKeyService.getCollection(
            process.env.DATABASE_NAME || 'fr_ai',
            MONGODB_COLLECTIONS.AI_GENERATED_POSTS
        );

        // Generate job_id
        const job_id = uuidv4();

        // Prepare options object
        let llmOptions = {};
        if (isAdvSettings && options) {
            if (options.temperature !== undefined) llmOptions.temperature = options.temperature;
            if (options.presence_penalty !== undefined) llmOptions.presencePenalty = options.presence_penalty;
            if (options.frequency_penalty !== undefined) llmOptions.frequencyPenalty = options.frequency_penalty;
            if (options.maximumLength !== undefined) llmOptions.maxTokens = options.maximumLength;
        }

        // Prepare job record for MongoDB
        const job_payload = {
            job_id,
            user_id,
            fb_user_id,
            model: model.trim(),
            provider,
            status: REPORT_STATUS.PENDING,
            prompts: {
                system_prompt: system_prompt || null,
                user_prompt: resolvedUserPrompt
            },
            options: llmOptions,
            created_at: new Date().toISOString().slice(0, 19).replace("T", " "),
            updated_at: new Date().toISOString().slice(0, 19).replace("T", " ")
        };

        if(friendFbId){
            job_payload['friendFbId'] = friendFbId;
        }
        if(fb_user_id){
            job_payload['fb_user_id'] = fb_user_id;
        }
        if(job_type){
            job_payload['job_type'] = job_type;
        }
        if(message_data){
            job_payload['message_data'] = message_data;
        }   
        if (ai_quick_message === true) {
            job_payload['ai_quick_message'] = true;
        }
        if(segments){
            job_payload['segments'] = segments;
        }
        if(gender){
            job_payload['gender'] = gender;
        }

        // Save initial record to database (collection: ai_generated_posts, db: fr_ai or DATABASE_NAME)
        const dbName = process.env.DATABASE_NAME || 'fr_ai';
        await db.insertOne(job_payload);
        console.log(`Inserted job ${job_id} into ${dbName}.${MONGODB_COLLECTIONS.AI_GENERATED_POSTS}`);

        const lambdaPayload = {
            Records: [{
                body: JSON.stringify({
                    job_id,
                    user_id,
                    friendFbId,
                    fb_user_id,
                    model: model.trim(),
                    job_type,
                    provider,
                    prompts: {
                        system_prompt: system_prompt || null,
                        user_prompt: resolvedUserPrompt
                    },
                    options: llmOptions,
                    ai_quick_message,
                    message_data,
                    segments,
                    gender,
                })
            }]
        };

        // Local / offline: invoke async handler in-process (same as generateFromFramework pattern for local dev)
        if (process.env.IS_OFFLINE === 'true') {
            const generateAiContentAsync = require('../asyncLambdas/generateAiContent').handler;
            console.log(`Local invocation: running async handler in-process for job: ${job_id}`);
            setImmediate(() => {
                generateAiContentAsync(lambdaPayload).catch(err => console.error('Local async execution error:', err));
            });
        } 
        // else {
        //     // AWS: invoke async Lambda (development/staging) or use SQS in production
        //     const lambda = new AWS.Lambda();
        //     const functionName = process.env.ASYNC_FUNCTION_NAME || `ai-service-${process.env.STAGE || 'dev'}-generateAiContentAsync`;
        //     console.log(`Invoking Lambda function: ${functionName} for job: ${job_id}`);
        //     await lambda.invoke({
        //         FunctionName: functionName,
        //         InvocationType: 'Event',
        //         Payload: JSON.stringify(lambdaPayload)
        //     }).promise();
        // }

        // === COMMENTED OUT: SQS Queue Processing (Use in Production) ===
        const sqs = new AWS.SQS();
        const queueUrl = process.env.AI_CONTENT_QUEUE_URL;
        
        if (!queueUrl) {
            throw new Error('AI_CONTENT_QUEUE_URL environment variable is not defined');
        }
        
        console.log(`Pushing to SQS queue: ${queueUrl} for job: ${job_id}`);
        
        const sqsParams = {
            MessageBody: JSON.stringify({
                job_id,
                user_id,
                friendFbId,
                model: model.trim(),
                provider,
                prompts: {
                    system_prompt: system_prompt || null,
                    user_prompt: resolvedUserPrompt
                },
                options: llmOptions
            }),
            QueueUrl: queueUrl
        };
        
        await sqs.sendMessage(sqsParams).promise();

        return Response.success({
            success: true,
            message: 'AI content generation job created',
            job_id,
            status: REPORT_STATUS.PENDING
        });
    } catch (error) {
        console.error('generateAiContent handler error:', error);
        return Response.failure({
            success: false,
            message: 'Failed to create AI content generation job',
            error: error.message,
        }, 500);
    }
};

const createAutomationJob = async ({
    user_id,
    provider,
    model,
    job_type,
    fb_user_id,
    identifier,
    automation_id,
    prompts,
    comments,
    options,
    post_text,
    // extraPayload = {},
    message
}) => {
    const providerConfig = DEFAULT_MODELS[provider];
    const modelStr = model && typeof model === 'string' && model.trim()
        ? model.trim()
        : (providerConfig?.CHAT || 'gpt-5-mini');


    const db = await UserApiKeyService.getCollection(
        process.env.DATABASE_NAME || 'fr_ai',
        MONGODB_COLLECTIONS.AI_GENERATED_POSTS
    );

    const job_id = uuidv4();
    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
    const sharedPayload = {
        job_id,
        user_id,
        job_type,
        fb_user_id: String(fb_user_id),
        identifier: String(identifier).trim(),
        automation_id: String(automation_id),
        model: modelStr,
        provider,
        status: REPORT_STATUS.PENDING,
        prompts,
        comments,
        options,
        post_text,
        created_at: now,
        updated_at: now
    };

    await db.insertOne(sharedPayload);

    const queueUrl = process.env.AI_CONTENT_QUEUE_URL;
    if (!queueUrl) {
        throw new Error('AI_CONTENT_QUEUE_URL environment variable is not defined');
    }

        const lambdaPayload = {
            Records: [{
                body: JSON.stringify({ ...sharedPayload })
            }]
        };

        // // Local / offline: invoke async handler in-process (same as generateFromFramework pattern for local dev)
        // if (process.env.IS_OFFLINE === 'true') {
        //     const generateAiContentAsync = require('../asyncLambdas/generateAiContent').handler;
        //     console.log(`Local invocation: running async handler in-process for job: ${job_id}`);
        //     setImmediate(() => {
        //         generateAiContentAsync(lambdaPayload).catch(err => console.error('Local async execution error:', err));
        //     });
        // } else {
        //     // AWS: invoke async Lambda (development/staging) or use SQS in production
        //     const lambda = new AWS.Lambda();
        //     const functionName = process.env.ASYNC_FUNCTION_NAME || `ai-service-${process.env.STAGE || 'dev'}-generateAiContentAsync`;
        //     console.log(`Invoking Lambda function: ${functionName} for job: ${job_id}`);
        //     await lambda.invoke({
        //         FunctionName: functionName,
        //         InvocationType: 'Event',
        //         Payload: JSON.stringify(lambdaPayload)
        //     }).promise();
        // }

    const sqs = new AWS.SQS();
    await sqs.sendMessage({
        MessageBody: JSON.stringify(sharedPayload),
        QueueUrl: queueUrl
    }).promise();

    return Response.success({
        success: true,
        message,
        job_id,
        status: REPORT_STATUS.PENDING
    });
};

/**
 * Async automation boolean evaluation (AI returns only true/false)
 * POST /llm/automation/boolean-eval
 * Body: { postText, fb_user_id, identifier, automation_id, system_prompt?, model?, provider?, isAdvSettings?, options? }
 */
const evaluateAutomationBoolean = async (event, context) => {
    try {
        const body = event.body || {};
        const {
            postText,
            fb_user_id,
            identifier,
            automation_id
        } = body;

        const user_id = getuser_idFromAuth(event);

        if (!user_id) {
            return Response.failure({ success: false, message: 'user_id is required' }, 400);
        }

        if (!postText || typeof postText !== 'string' || !postText.trim()) {
            return Response.failure({ success: false, message: 'postText is required' }, 400);
        }
        if (fb_user_id === undefined || fb_user_id === null || fb_user_id === '') {
            return Response.failure({ success: false, message: 'fb_user_id is required' }, 400);
        }
        if (identifier === undefined || identifier === null || String(identifier).trim() === '') {
            return Response.failure({ success: false, message: 'identifier is required' }, 400);
        }
        if (automation_id === undefined || automation_id === null || automation_id === '') {
            return Response.failure({ success: false, message: 'automation_id is required' }, 400);
        }

        const defaultModel = await UserApiKeyService.getDefaultModel(user_id);
        if (!defaultModel) {
            return Response.failure({ success: false, message: 'Default model not found' }, 404);
        }
        const provider = defaultModel.provider;
        const model = defaultModel.modelName;
        //const llmOptions = buildLlmOptions(isAdvSettings, options, { temperature: 0 });
        // Prepare options object
        let llmOptions = {};

        const fbUserStr = String(fb_user_id);
        const identifierStr = String(identifier).trim();
        const automationIdStr = String(automation_id);

         const automationDb = await AutomationService.getCollection(
                'fr_profile',
                'automation_actions'
         );   

        const actionDetails = await automationDb.findOne({ identifier });

        if (!actionDetails) {
                return Response.failure({
                    success: false,
                    message: 'Action not found'
                }, 404);
        }

            //const systemPrompt = actionDetails?.config?.system_prompt;
        const userPrompt = actionDetails?.config?.ai_filter?.prompt;

        return await createAutomationJob({
            user_id,
            provider,
            model,
            job_type: JOB_TYPE_AUTOMATION_BOOLEAN,
            fb_user_id: fbUserStr,
            identifier: identifierStr,
            automation_id: automationIdStr,
            post_text: postText.trim(),
            prompts: {
                user_prompt: userPrompt
            },
            options: llmOptions,
            message: 'Automation boolean evaluation job created'
        });
    } catch (error) {
        console.error('evaluateAutomationBoolean handler error:', error);
        return Response.failure({
            success: false,
            message: 'Failed to create automation boolean evaluation job',
            error: error.message,
        }, 500);
    }
};

/**
 * Async automation comment generation
 * POST /llm/automation/generate-comment
 * Body: { postText, fb_user_id, identifier, automation_id, system_prompt?, model?, provider?, isAdvSettings?, options? }
 */
const generateAutomationComment = async (event, context) => {
    try {
        const body = event.body || {};
        const {
            postText,
            fb_user_id,
            identifier,
            automation_id,
            comments
        } = body;

        const user_id = getuser_idFromAuth(event);
        if (!user_id) return Response.failure({ success: false, message: 'user_id is required' }, 400);
        if (!postText || typeof postText !== 'string' || !postText.trim()) {
            return Response.failure({ success: false, message: 'postText is required' }, 400);
        }
        if (fb_user_id === undefined || fb_user_id === null || fb_user_id === '') {
            return Response.failure({ success: false, message: 'fb_user_id is required' }, 400);
        }
        if (identifier === undefined || identifier === null || String(identifier).trim() === '') {
            return Response.failure({ success: false, message: 'identifier is required' }, 400);
        }
        if (automation_id === undefined || automation_id === null || automation_id === '') {
            return Response.failure({ success: false, message: 'automation_id is required' }, 400);
        }

        const defaultModel = await UserApiKeyService.getDefaultModel(user_id);
        if (!defaultModel) {
            return Response.failure({ success: false, message: 'Default model not found' }, 404);
        }
        const provider = defaultModel.provider;
        const model = defaultModel.modelName;

        // Prepare options object
        let llmOptions = {};

        const postTextClean = postText.trim();

           const automationDb = await AutomationService.getCollection(
                'fr_profile',
                'automation_actions'
            );   

            const actionDetails = await automationDb.findOne({ identifier });

            if (!actionDetails) {
                return Response.failure({
                    success: false,
                    message: 'Action not found'
                }, 404);
            }

            const systemPrompt = actionDetails?.config?.comment?.system_prompt;
            const userPrompt = actionDetails?.config?.comment?.user_prompt;

        return await createAutomationJob({
            user_id,
            provider,
            model,
            job_type: JOB_TYPE_GENERATE_COMMENT,
            fb_user_id,
            identifier,
            automation_id,
            post_text: postTextClean,
            comments: comments,
            prompts: {
                ...(systemPrompt && typeof systemPrompt === 'string' && systemPrompt.trim()
                    ? { system_prompt: systemPrompt.trim() }
                    : {}),
                user_prompt: userPrompt
            },
            options: llmOptions, 
            //user_prompt,
            message: 'Automation comment generation job created'
        });
    } catch (error) {
        console.error('generateAutomationComment handler error:', error);
        return Response.failure({
            success: false,
            message: 'Failed to create automation comment generation job',
            error: error.message,
        }, 500);
    }
};

/**
 * Async automation reaction generation
 * POST /llm/automation/generate-reaction
 * Body: { postText, fb_user_id, identifier, automation_id, reactions, system_prompt?, model?, provider?, isAdvSettings?, options? }
 */
const generateAutomationReaction = async (event, context) => {
    try {
        const body = event.body || {};
        const {
            postText,
            fb_user_id,
            identifier,
            automation_id,
        } = body;

        const user_id = getuser_idFromAuth(event);
        if (!user_id) return Response.failure({ success: false, message: 'user_id is required' }, 400);
        if (!postText || typeof postText !== 'string' || !postText.trim()) {
            return Response.failure({ success: false, message: 'postText is required' }, 400);
        }
        if (fb_user_id === undefined || fb_user_id === null || fb_user_id === '') {
            return Response.failure({ success: false, message: 'fb_user_id is required' }, 400);
        }
        if (identifier === undefined || identifier === null || String(identifier).trim() === '') {
            return Response.failure({ success: false, message: 'identifier is required' }, 400);
        }
        if (automation_id === undefined || automation_id === null || automation_id === '') {
            return Response.failure({ success: false, message: 'automation_id is required' }, 400);
        }

        const defaultModel = await UserApiKeyService.getDefaultModel(user_id);
        if (!defaultModel) {
            return Response.failure({ success: false, message: 'Default model not found' }, 404);
        }
        const provider = defaultModel.provider;
        const model = defaultModel.modelName;

        const normalizedReactions = REACTION_TYPES
            .map((item) => ({
                id: item?.id ? String(item.id).trim() : '',
                label: item.label,
                Icon: item.Icon
            }));

        if (normalizedReactions.length === 0) {
            return Response.failure({
                success: false,
                message: 'reactions must include at least one item with id'
            }, 400);
        }

        const reactionListText = normalizedReactions
            .map((item) => item.label ? `${item.id} (${item.label})` : item.id)
            .join(', ');

        const postTextClean = postText.trim();
        //const llmOptions = buildLlmOptions(isAdvSettings, options, { temperature: 0 });

        // Prepare options object
        let llmOptions = {};

         const automationDb = await AutomationService.getCollection(
                'fr_profile',
                'automation_actions'
            );   

            const actionDetails = await automationDb.findOne({ identifier });

            if (!actionDetails) {
                return Response.failure({
                    success: false,
                    message: 'Action not found'
                }, 404);
            }

            // const systemPrompt = actionDetails?.config?.reaction?.system_prompt;
            // const userPrompt = actionDetails?.config?.reaction?.user_prompt;

        return await createAutomationJob({
            user_id,
            provider,
            model,
            job_type: JOB_TYPE_GENERATE_REACTION,
            fb_user_id,
            identifier,
            automation_id,
            post_text: postTextClean,
            prompts: {
                user_prompt: ""
            },
            options: llmOptions,
            //user_prompt,
            message: 'Automation reaction generation job created'
        });
    } catch (error) {
        console.error('generateAutomationReaction handler error:', error);
        return Response.failure({
            success: false,
            message: 'Failed to create automation reaction generation job',
            error: error.message,
        }, 500);
    }
};

/**
 * Async automation: generate comment + reaction in ONE AI call
 * POST /llm/automation/generate-comment-reaction
 * Body: { postText, fb_user_id, identifier, automation_id, model?, provider?, isAdvSettings?, options? }
 */
const generateAutomationCommentAndReaction = async (event, context) => {
    try {
        const body = event.body || {};
        const {
            postText,
            fb_user_id,
            identifier,
            automation_id,
            comments
        } = body;

        const user_id = getuser_idFromAuth(event);
        if (!user_id) return Response.failure({ success: false, message: 'user_id is required' }, 400);
        if (!postText || typeof postText !== 'string' || !postText.trim()) {
            return Response.failure({ success: false, message: 'postText is required' }, 400);
        }
        if (fb_user_id === undefined || fb_user_id === null || fb_user_id === '') {
            return Response.failure({ success: false, message: 'fb_user_id is required' }, 400);
        }
        if (identifier === undefined || identifier === null || String(identifier).trim() === '') {
            return Response.failure({ success: false, message: 'identifier is required' }, 400);
        }
        if (automation_id === undefined || automation_id === null || automation_id === '') {
            return Response.failure({ success: false, message: 'automation_id is required' }, 400);
        }

        const defaultModel = await UserApiKeyService.getDefaultModel(user_id);
        if (!defaultModel) {
            return Response.failure({ success: false, message: 'Default model not found' }, 404);
        }
        const provider = defaultModel.provider;
        const model = defaultModel.modelName;

        // Prepare options object
        let llmOptions = {};

        const postTextClean = postText.trim();

        const automationDb = await AutomationService.getCollection('fr_profile', 'automation_actions');
        const actionDetails = await automationDb.findOne({ identifier });
        if (!actionDetails) {
            return Response.failure({ success: false, message: 'Action not found' }, 404);
        }

        const commentPrompt = actionDetails?.config?.comment?.user_prompt;
        const reactionPrompt = actionDetails?.config?.reaction?.user_prompt;
        const combinedUserPrompt = `comment_prompt:\n${commentPrompt || 'Generate one natural comment.'}\n\nreaction_prompt:\n${reactionPrompt || 'Choose the best reaction id.'}`;

        return await createAutomationJob({
            user_id,
            provider,
            model,
            job_type: JOB_TYPE_GENERATE_COMMENT_AND_REACTION,
            fb_user_id,
            identifier,
            automation_id,
            post_text: postTextClean,
            comments: comments, // array of comments
            prompts: {
                user_prompt: actionDetails?.config?.comment?.user_prompt,
                system_prompt: actionDetails?.config?.comment?.system_prompt
            },
            options: llmOptions,
            message: 'Automation comment+reaction job created'
        });
    } catch (error) {
        console.error('generateAutomationCommentAndReaction handler error:', error);
        return Response.failure({
            success: false,
            message: 'Failed to create automation comment+reaction job',
            error: error.message,
        }, 500);
    }
};

/**
 * Fix AI content asynchronously
 * POST /llm/fix/ai-content
 * Body: { original_content, fix_instructions, model, provider?, isAdvSettings?, options? }
 */
const fixAiContent = async (event, context) => {
    try {
        const body = event.body || {};
        const {
            original_content,
            fix_instructions,
            model,
            provider = 'openai',
            isAdvSettings = false,
            options = {}
        } = body;

        const user_id = getuser_idFromAuth(event);

        if (!user_id) {
            return Response.failure({ success: false, message: 'user_id is required' }, 400);
        }

        if (!original_content || typeof original_content !== 'string' || !original_content.trim()) {
            return Response.failure({ success: false, message: 'original_content is required' }, 400);
        }

        if (!fix_instructions || typeof fix_instructions !== 'string' || !fix_instructions.trim()) {
            return Response.failure({ success: false, message: 'fix_instructions is required' }, 400);
        }

        if (!model || typeof model !== 'string' || !model.trim()) {
            return Response.failure({ success: false, message: 'model is required (model name string)' }, 400);
        }

        const validProviders = Object.values(LLM_PROVIDERS);
        if (!validProviders.includes(provider)) {
            return Response.failure({
                success: false,
                message: `Invalid provider. Valid providers: ${validProviders.join(', ')}`,
            }, 400);
        }

        const dbName = process.env.DATABASE_NAME || 'fr_ai';
        const db = await UserApiKeyService.getCollection(dbName, MONGODB_COLLECTIONS.AI_GENERATED_POSTS);

        const job_id = uuidv4();

        let llmOptions = {};
        if (isAdvSettings && options) {
            if (options.temperature !== undefined) llmOptions.temperature = options.temperature;
            if (options.presence_penalty !== undefined) llmOptions.presencePenalty = options.presence_penalty;
            if (options.frequency_penalty !== undefined) llmOptions.frequencyPenalty = options.frequency_penalty;
            if (options.maximumLength !== undefined) llmOptions.maxTokens = options.maximumLength;
        }

        const job_payload = {
            job_id,
            user_id,
            job_type: 'fix',
            model: model.trim(),
            provider,
            status: REPORT_STATUS.PENDING,
            prompts: {
                original_content: original_content.trim(),
                fix_instructions: fix_instructions.trim()
            },
            options: llmOptions,
            created_at: new Date().toISOString().slice(0, 19).replace("T", " "),
            updated_at: new Date().toISOString().slice(0, 19).replace("T", " ")
        };

        await db.insertOne(job_payload);
        console.log(`Inserted fix job ${job_id} into ${dbName}.${MONGODB_COLLECTIONS.AI_GENERATED_POSTS}`);

        const sqs = new AWS.SQS();
        const queueUrl = process.env.FIX_AI_CONTENT_QUEUE_URL;

        if (!queueUrl) {
            throw new Error('FIX_AI_CONTENT_QUEUE_URL environment variable is not defined');
        }

        console.log(`Pushing to SQS queue: ${queueUrl} for fix job: ${job_id}`);

        const sqsParams = {
            MessageBody: JSON.stringify({
                job_id,
                user_id,
                model: model.trim(),
                provider,
                prompts: {
                    original_content: original_content.trim(),
                    fix_instructions: fix_instructions.trim()
                },
                options: llmOptions
            }),
            QueueUrl: queueUrl
        };

        await sqs.sendMessage(sqsParams).promise();

        return Response.success({
            success: true,
            message: 'AI content fix job created',
            job_id,
            status: REPORT_STATUS.PENDING
        });
    } catch (error) {
        console.error('fixAiContent handler error:', error);
        return Response.failure({
            success: false,
            message: 'Failed to create AI content fix job',
            error: error.message,
        }, 500);
    }
};

/**
 * Generate AI image asynchronously
 * POST /llm/generate/ai-image
 * Body: { system_prompt?, user_prompt, model?, provider?, isAdvSettings?, options? }
 */
const generateAiImage = async (event, context) => {
    try {
        const body = event.body || {};
        const {
            system_prompt,
            user_prompt,
            number_of_images,
            model,
            provider = 'openai',
            isAdvSettings = false,
            options = {}
        } = body;

        const user_id = getuser_idFromAuth(event);

        if (!user_id) {
            return Response.failure({ success: false, message: 'user_id is required' }, 400);
        }

        if (!user_prompt) {
            return Response.failure({ success: false, message: 'user_prompt is required' }, 400);
        }

        if (!number_of_images) {
            return Response.failure({ success: false, message: 'number_of_images is required' }, 400);
        }

        // Validate provider
        const validProviders = Object.values(LLM_PROVIDERS);
        if (!validProviders.includes(provider)) {
            return Response.failure({
                success: false,
                message: `Invalid provider. Valid providers: ${validProviders.join(', ')}`,
            }, 400);
        }

        // Get database connection
        const db = await UserApiKeyService.getCollection(
            process.env.DATABASE_NAME || 'fr_ai',
            MONGODB_COLLECTIONS.AI_GENERATED_POSTS
        );

        // Generate job_id
        const job_id = uuidv4();

        // Prepare options object
        let llmOptions = {};
        if (isAdvSettings && options) {
            if (options.temperature !== undefined) llmOptions.temperature = options.temperature;
            if (options.presence_penalty !== undefined) llmOptions.presencePenalty = options.presence_penalty;
            if (options.frequency_penalty !== undefined) llmOptions.frequencyPenalty = options.frequency_penalty;
            if (options.maximumLength !== undefined) llmOptions.maxTokens = options.maximumLength;
        }

        // Prepare job record for MongoDB
        const modelStr = model && typeof model === 'string' ? model.trim() : null;
        const job_payload = {
            job_id,
            user_id,
            model: modelStr,
            provider,
            status: REPORT_STATUS.PENDING,
            prompts: {
                system_prompt: system_prompt || null,
                user_prompt
            },
            images: [],
            options: llmOptions,
            created_at: new Date().toISOString().slice(0, 19).replace("T", " "),
            updated_at: new Date().toISOString().slice(0, 19).replace("T", " ")
        };

        // Save initial record to database (collection: ai_generated_posts, db: fr_ai or DATABASE_NAME)
        const dbName = process.env.DATABASE_NAME || 'fr_ai';
        await db.insertOne(job_payload);
        console.log(`Inserted job ${job_id} into ${dbName}.${MONGODB_COLLECTIONS.AI_GENERATED_POSTS}`);


          const lambdaPayload = {
            Records: [{
                body: JSON.stringify({
                    job_id,
                    user_id,
                    model: modelStr,
                    provider,
                    prompts: {
                        system_prompt: system_prompt || null,
                        user_prompt
                    },
                    options: llmOptions,
                    total_images: number_of_images
                })
            }]
        };

        // Local / offline: invoke async handler in-process (same as generateFromFramework pattern for local dev)
        // if (process.env.IS_OFFLINE === 'true') {
        //     const generateAiImageAsync = require('../asyncLambdas/generateAiImage').handler;
        //     console.log(`Local invocation: running async handler in-process for job: ${job_id}`);
        //     setImmediate(() => {
        //         generateAiImageAsync(lambdaPayload).catch(err => console.error('Local async execution error:', err));
        //     });
        // } 
        //else {
        //     // AWS: invoke async Lambda (development/staging) or use SQS in production
        //     const lambda = new AWS.Lambda();
        //     const functionName = process.env.ASYNC_FUNCTION_NAME || `ai-service-${process.env.STAGE || 'dev'}-generateAiContentAsync`;
        //     console.log(`Invoking Lambda function: ${functionName} for job: ${job_id}`);
        //     await lambda.invoke({
        //         FunctionName: functionName,
        //         InvocationType: 'Event',
        //         Payload: JSON.stringify(lambdaPayload)
        //     }).promise();
        // }

        // === COMMENTED OUT: SQS Queue Processing (Use in Production) ===
        const sqs = new AWS.SQS();
        const queueUrl = process.env.AI_IMAGE_QUEUE_URL;

        if (!queueUrl) {
            throw new Error('AI_IMAGE_QUEUE_URL environment variable is not defined');
        }

        console.log(`Pushing to SQS queue: ${queueUrl} for job: ${job_id}`);

        const sqsParams = {
            MessageBody: JSON.stringify({
                job_id,
                user_id,
                model: modelStr,
                provider,
                prompts: {
                    system_prompt: system_prompt || null,
                    user_prompt
                },
                options: llmOptions,
                total_images: number_of_images,
                type: 'image'
            }),
            QueueUrl: queueUrl
        };

        await sqs.sendMessage(sqsParams).promise();

        return Response.success({
            success: true,
            message: 'AI content generation job created',
            job_id,
            status: REPORT_STATUS.PENDING
        });
    } catch (error) {
        console.error('generateAiImage handler error:', error);
        return Response.failure({
            success: false,
            message: 'Failed to create AI image generation job',
            error: error.message,
        }, 500);
    }
};

/**
 * Get available models for a provider
 * GET /llm/models?provider=openai|anthropic|openrouter
 */
const getModels = async (event, context) => {
    try {
        const provider = (event.queryStringParameters?.provider || 'openai').toLowerCase();
        const validProviders = Object.values(LLM_PROVIDERS);
        if (!validProviders.includes(provider)) {
            return Response.failure({
                success: false,
                message: `Invalid provider. Valid providers: ${validProviders.join(', ')}`,
            }, 400);
        }
        const { text_models, image_models } = await getModelsForProvider(provider);
        return Response.success({
            success: true,
            provider,
            text_models,
            image_models,
        });
    } catch (error) {
        console.error('getModels handler error:', error);
        return Response.failure({
            success: false,
            message: 'Failed to fetch models',
            error: error.message,
        }, 500);
    }
};

/**
 * Get AI content job status
 * GET /llm/ai-content-status?job_id=xxx
 */
const getAiContentJobStatus = async (event, context) => {
    try {
        const { job_id } = event.queryStringParameters || {};
        const user_id = getuser_idFromAuth(event);

        if (!user_id) {
            return Response.failure({ success: false, message: 'user_id is required' }, 400);
        }

        if (!job_id) {
            return Response.failure({ success: false, message: 'job_id query parameter is required' }, 400);
        }

        // Get database connection
        const db = await UserApiKeyService.getCollection(
            process.env.DATABASE_NAME || 'fr_ai',
            MONGODB_COLLECTIONS.AI_GENERATED_POSTS
        );

        // Query for the job
        const job = await db.findOne({ job_id, user_id });

        if (!job) {
            return Response.failure({
                success: false,
                message: 'Job not found'
            }, 404);
        }

        // Prepare response based on status
        const response = {
            success: true,
            job_id: job.job_id,
            status: job.status,
            created_at: job.created_at,
            updated_at: job.updated_at,
            images: job.images || [],
            content: job.content || null
        };

        if (job.job_type) {
            response.job_type = job.job_type;
        }

        // Add content if completed
        if (job.status === REPORT_STATUS.COMPLETED && (job.content || job.images)) {
            response.content = job.content;
            response.metadata = job.metadata;
            response.images = job.images;
        }

        // Add error if errored
        if (job.status === REPORT_STATUS.ERROR && job.error) {
            response.error = job.error;
            response.error_acknowledged = job.error_acknowledged || false;
        }

        return Response.success(response);
    } catch (error) {
        console.error('getAiContentJobStatus handler error:', error);
        return Response.failure({
            success: false,
            message: 'Failed to get job status',
            error: error.message,
        }, 500);
    }
};

/**
 * Get AI errors for a user
 * GET /llm/ai-errors?fb_user_id=xxx
 * Returns documents from ai_errors collection where acknowledge is false
 */
const getAiErrors = async (event, context) => {
    try {
        const user_id = getuser_idFromAuth(event);

        if (!user_id) {
            return Response.failure({ success: false, message: 'user_id is required' }, 400);
        }

        const db = await UserApiKeyService.getCollection(
            process.env.DATABASE_NAME || 'fr_ai',
            MONGODB_COLLECTIONS.AI_ERRORS
        );

        const errors = await db.aggregate([
            {
                $match: {
                    user_id,
                    acknowledge: false
                }
            },
            {
                $project: {
                    user_id: 1,
                    error_message: 1,
                    acknowledge: 1,
                    created_at: 1,
                    updated_at: 1,
                    _id: 0
                }
            }
        ]);

        return Response.success({
            success: true,
            data: errors[0] || {}
        });
    } catch (error) {
        console.error('getAiErrors handler error:', error);
        return Response.failure({
            success: false,
            message: 'Failed to fetch AI errors',
            error: error.message,
        }, 500);    
    }
};

/**
 * Acknowledge AI errors for a user / fb_user_id
 * POST /llm/ai-errors/acknowledge
 * Body: { fb_user_id }
 * Updates acknowledge: true for all matching { user_id, fb_user_id }
 */
const acknowledgeAiError = async (event, context) => {
    try {
        const body = event.body || {};
        const user_id = getuser_idFromAuth(event);

        if (!user_id) {
            return Response.failure({ success: false, message: 'user_id is required' }, 400);
        }

        const db = await UserApiKeyService.getCollection(
            process.env.DATABASE_NAME || 'fr_ai',
            MONGODB_COLLECTIONS.AI_ERRORS
        );

        const updateResult = await db.updateMany(
            { user_id },
            {
                $set: {
                    acknowledge: true,
                    updated_at: new Date().toISOString().slice(0, 19).replace('T', ' ')
                }
            }
        );

        return Response.success({
            success: true,
            message: 'AI errors acknowledged successfully',
            user_id,
        });
    } catch (error) {
        console.error('acknowledgeAiError handler error:', error);
        return Response.failure({
            success: false,
            message: 'Failed to acknowledge AI errors',
            error: error.message,
        }, 500);
    }
};

module.exports = {
    generateContent,
    analyzeContent,
    chatCompletion,
    generateFromFramework,
    saveApiKey,
    getUserProviders,
    deleteApiKey,
    validateApiKey,
    getReportStatus,
    acknowledgeReportError,
    generateAiContent,
    fixAiContent,
    generateAiImage,
    getModels,
    getAiContentJobStatus,
    evaluateAutomationBoolean,
    generateAutomationComment,
    generateAutomationReaction,
    generateAutomationCommentAndReaction,
    getAiErrors,
    acknowledgeAiError,
};