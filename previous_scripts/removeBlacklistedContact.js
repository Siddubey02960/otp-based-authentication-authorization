/**
 * Remove blacklisted contacts from friends_queue, automations, pipelines, and campaigns.
 *
 * Profile-wise cleanup script:
 * - Loads profiles (optionally filtered via targetUserIds)
 * - For each profile, loads friend_lists with blacklist_status = 1 and collects all friendFbIds
 * - Processes all blacklisted friendFbIds together per step:
 *   Step 1: friends_queue where is_active = true and status = null → deactivate + queue removed activity
 *   Step 2: automation_contacts in progress → mark failed (no activity)
 *   Step 3: pipeline_stage_contacts → soft-delete + pipeline removed activity
 *   Step 4: for each active campaign, remove blacklisted friendFbIds with pending / Pending encrypted status + update counts
 *
 * HOW TO RUN
 * ----------
 *   node previous_scripts/removeBlacklistedContact.js
 */

const { MongoClient, ObjectId } = require('mongodb');
require('dotenv').config();

const uri = 'mongodb+srv://FR_SECRET_DEV:KxZLWdg5dwOfGB1i@cluster0.u2quf8g.mongodb.net/';
// const uri = 'mongodb+srv://FR_SECRET_READ_BETA:wjbQ3Pr1ZUPeDZ46@fr-frlst-beta.qricz.mongodb.net/';

const PROFILE_DB = process.env.DATABASE_NAME || 'fr_profile';
const CAMPAIGN_DB = 'fr_campaigns';

const BLACKLIST_ACTIVITY_LOCATION = 'blacklisted';
const BLACKLIST_AUTOMATION_FAILURE_REASON = 'Contact has been blacklisted';

const ACTIVITY_TYPE_CAMPAIGN = 7;
const ACTIVITY_TYPE_QUEUE = 13;
const ACTIVITY_TYPE_PIPELINE = 38;

const ACTION_REMOVED = 2;

const AUTOMATION_STATUS_IN_PROGRESS = 1;
const AUTOMATION_STATUS_FAILED = 3;

const FRIEND_CAMPAIGNS_COLLECTION = 'friend_campaigns';
const CAMPAIGNS_COLLECTION = 'campaigns';
const PENDING_CAMPAIGN_STATUSES = ['pending', 'Pending encrypted'];

function getNow() {
    return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

function toIdString(val) {
    if (val == null) return '';
    if (typeof val === 'string') return val;
    if (val instanceof ObjectId) return val.toString();
    if (typeof val.toString === 'function') return val.toString();
    return '';
}

function notDeletedFilter() {
    return {
        $or: [
            { deleted_at: null },
            { deleted_at: '' },
            { deleted_at: { $exists: false } },
        ],
    };
}

function toObjectId(id) {
    if (id instanceof ObjectId) return id;
    if (ObjectId.isValid(String(id))) return new ObjectId(String(id));
    return null;
}

async function updateCampaignContactCountAfterRemoval({
    campaignsCollection,
    campaign,
    removedCount,
}) {
    if (!campaign?._id || !removedCount) return;

    const currentFriendsAdded = Number(campaign.friends_added) || 0;
    const currentFriendsPending = Number(campaign.friends_pending) || 0;

    const friendsAdded = Math.max(0, currentFriendsAdded - removedCount);
    const friendsPending = Math.max(0, currentFriendsPending - removedCount);
 
    await campaignsCollection.updateOne(
        { _id: campaign._id },
        {
            $set: {
                friends_added: friendsAdded,
                friends_pending: friendsPending,
            },
        }
    );
}

async function getPipelineNameMaps({
    pipelinesCollection,
    pipelineStagesCollection,
    pipelineIds,
    stageIds,
}) {
    const pipelineNameMap = new Map();
    const stageNameMap = new Map();

    const pipelineObjectIds = pipelineIds.map(toObjectId).filter(Boolean);
    if (pipelineObjectIds.length) {
        const pipelines = await pipelinesCollection
            .find({ _id: { $in: pipelineObjectIds } })
            .project({ name: 1, title: 1 })
            .toArray();

        for (const pipeline of pipelines) {
            pipelineNameMap.set(
                toIdString(pipeline._id),
                pipeline?.name || pipeline?.title || ''
            );
        }
    }

    const stageObjectIds = stageIds.map(toObjectId).filter(Boolean);
    if (stageObjectIds.length) {
        const stages = await pipelineStagesCollection
            .find({ _id: { $in: stageObjectIds } })
            .project({ name: 1, title: 1 })
            .toArray();

        for (const stage of stages) {
            stageNameMap.set(toIdString(stage._id), stage?.name || stage?.title || '');
        }
    }

    return { pipelineNameMap, stageNameMap };
}

async function removeBlacklistedContactsForProfile({
    profile,
    collections,
    stats,
}) {
    const userId = Number(profile.user_id);
    const fbUserId = String(profile.fb_user_id);
    const now = getNow();

    const blacklistedContacts = await collections.friendListsCollection
        .find({
            user_id: userId,
            fb_user_id: fbUserId,
            blacklist_status: 1,
            friendFbId: { $exists: true, $nin: [null, ''] },
        })
        .project({ _id: 1, friendFbId: 1, friendName: 1 })
        .toArray();

    if (!blacklistedContacts.length) {
        return;
    }

    const friendFbIds = [
        ...new Set(blacklistedContacts.map((contact) => String(contact.friendFbId))),
    ];

    console.log(
        `Profile user_id=${userId}, fb_user_id=${fbUserId}: ${friendFbIds.length} blacklisted friendFbId(s)`
    );

    // Step 1: friends_queue (is_active true, status null)
    const queueRecords = await collections.friendsQueueCollection
        .find({
            user_id: userId,
            fb_user_id: fbUserId,
            friendFbId: { $in: friendFbIds },
            is_active: true,
            status: null,
        })
        .toArray();

    if (queueRecords.length) {
        await collections.friendsQueueCollection.updateMany(
            { _id: { $in: queueRecords.map((record) => record._id) } },
            { $set: { is_active: false, updated_at: now } }
        );

        await collections.activityCollection.insertMany(
            queueRecords.map((record) => ({
                user_id: userId,
                fb_user_id: fbUserId,
                created_at: now,
                activity_type: ACTIVITY_TYPE_QUEUE,
                action: ACTION_REMOVED,
                friendFbId: String(record.friendFbId),
                location: BLACKLIST_ACTIVITY_LOCATION,
                script: true,
            }))
        );

        stats.queueRemoved += queueRecords.length;
        console.log(
            `[friends_queue removed] user_id=${userId} count=${queueRecords.length}`
        );
    }

    // Step 2: automations (fail in-progress contacts, no activity)
    const automationContacts = await collections.automationContactsCollection
        .find({
            user_id: userId,
            fb_user_id: fbUserId,
            friendFbId: { $in: friendFbIds },
            status: { $in: [AUTOMATION_STATUS_IN_PROGRESS, 2] },
        })
        .toArray();

    if (automationContacts.length) {
        await collections.automationContactsCollection.updateMany(
            { _id: { $in: automationContacts.map((contact) => contact._id) } },
            {
                $set: {
                    status: AUTOMATION_STATUS_FAILED,
                    failure_reason: BLACKLIST_AUTOMATION_FAILURE_REASON,
                    updated_at: now,
                },
            }
        );

        stats.automationFailed += automationContacts.length;
        console.log(
            `[automation failed] user_id=${userId} count=${automationContacts.length}`
        );
    }

    // Step 3: pipelines
    const pipelineContacts = await collections.pipelineStageContactsCollection
        .find({
            user_id: userId,
            friendFbId: { $in: friendFbIds },
            ...notDeletedFilter(),
        })
        .toArray();

    if (pipelineContacts.length) {
        const pipelineIds = [
            ...new Set(pipelineContacts.map((contact) => toIdString(contact.pipeline_id)).filter(Boolean)),
        ];
        const stageIds = [
            ...new Set(pipelineContacts.map((contact) => toIdString(contact.stage_id)).filter(Boolean)),
        ];
        const { pipelineNameMap, stageNameMap } = await getPipelineNameMaps({
            pipelinesCollection: collections.pipelinesCollection,
            pipelineStagesCollection: collections.pipelineStagesCollection,
            pipelineIds,
            stageIds,
        });

        await collections.pipelineStageContactsCollection.updateMany(
            { _id: { $in: pipelineContacts.map((contact) => contact._id) } },
            {
                $set: {
                    deleted_at: now,
                    removed_at: now,
                    updated_at: now,
                },
            }
        );

        await collections.activityCollection.insertMany(
            pipelineContacts.map((contact) => {
                const pipelineId = toIdString(contact.pipeline_id);
                const stageId = toIdString(contact.stage_id);

                return {
                    user_id: userId,
                    fb_user_id: fbUserId,
                    friendFbId: String(contact.friendFbId),
                    created_at: now,
                    activity_type: ACTIVITY_TYPE_PIPELINE,
                    action: ACTION_REMOVED,
                    location: BLACKLIST_ACTIVITY_LOCATION,
                    activity_info: {
                        pipeline_id: pipelineId,
                        pipeline_name: pipelineNameMap.get(pipelineId) || '',
                        stage_id: stageId,
                        stage_name: stageNameMap.get(stageId) || '',
                        location: BLACKLIST_ACTIVITY_LOCATION,
                    },
                    script: true,
                };
            })
        );

        const friendListPipelinePulls = new Map();
        for (const contact of pipelineContacts) {
            const friendFbId = String(contact.friendFbId);
            const pipelineId = toIdString(contact.pipeline_id);
            if (!pipelineId) continue;
            friendListPipelinePulls.set(`${friendFbId}::${pipelineId}`, {
                friendFbId,
                pipelineId,
            });
        }

        if (friendListPipelinePulls.size) {
            await collections.friendListsCollection.bulkWrite(
                [...friendListPipelinePulls.values()].map(({ friendFbId, pipelineId }) => ({
                    updateOne: {
                        filter: {
                            user_id: userId,
                            fb_user_id: fbUserId,
                            friendFbId,
                        },
                        update: {
                            $pull: { pipeline_ids: pipelineId },
                        },
                    },
                }))
            );
        }

        stats.pipelineRemoved += pipelineContacts.length;
        console.log(
            `[pipeline removed] user_id=${userId} count=${pipelineContacts.length}`
        );
    } 

    // Step 4: campaigns — iterate active campaigns, remove pending blacklisted contacts
    const activeCampaigns = await collections.campaignsCollection
        .find({
            user_id: userId,
            fb_user_id: fbUserId,
            deleted_at: {$in: [null, '']},
        })
        .project({
            _id: 1,
            campaign_name: 1,
            name: 1,
            title: 1,
            friends_added: 1,
            friends_pending: 1,
        })
        .toArray();

    for (const campaign of activeCampaigns) {
        const campaignId = campaign._id;
        const campaignIdStr = toIdString(campaignId);
        const campaignName =
            campaign.campaign_name || campaign.name || campaign.title || '';

        const campaignContacts = await collections.friendCampaignsCollection
            .find({
                user_id: userId,
                fb_user_id: fbUserId,
                friendFbId: { $in: friendFbIds },
                status: { $in: PENDING_CAMPAIGN_STATUSES },
                $or: [
                    { campaign_id: campaignId },
                    { campaign_id: campaignIdStr },
                ],
                deleted_at: {$in: [null, '']},
            })
            .toArray();

        if (!campaignContacts.length) {
            continue;
        }

        await collections.friendCampaignsCollection.updateMany(
            { _id: { $in: campaignContacts.map((contact) => contact._id) } },
            { $set: { deleted_at: now, updated_at: now } }
        );

        await collections.activityCollection.insertMany(
            campaignContacts.map((contact) => ({
                user_id: userId,
                fb_user_id: fbUserId,
                created_at: now,
                activity_type: ACTIVITY_TYPE_CAMPAIGN,
                action: ACTION_REMOVED,
                campaign_id: contact.campaign_id,
                campaign_name: campaignName,
                friendFbId: String(contact.friendFbId),
                location: BLACKLIST_ACTIVITY_LOCATION,
                script: true,
            }))
        );

        const removedCount = campaignContacts.length;

        await updateCampaignContactCountAfterRemoval({
            campaignsCollection: collections.campaignsCollection,
            campaign,
            removedCount,
        }); 

        stats.campaignRemoved += removedCount;
        stats.campaignCountsUpdated += 1;

        console.log(
            `[campaign removed] user_id=${userId} campaign_id=${campaignIdStr} count=${campaignContacts.length}`
        );
    }

    stats.profilesProcessed += 1;
}

async function runRemoveBlacklistedContactsScript() {
    const client = new MongoClient(uri, {
        useNewUrlParser: true,
        useUnifiedTopology: true,
        serverSelectionTimeoutMS: 30000,
    });

    const targetUserId = [1909]

    const stats = {
        profilesProcessed: 0,
        campaignRemoved: 0,
        automationFailed: 0,
        pipelineRemoved: 0,
        queueRemoved: 0,
        campaignCountsUpdated: 0,
    };

    try {
        await client.connect();
        console.log('Connected to MongoDB');

        const profileDb = client.db(PROFILE_DB);
        const campaignDb = client.db(CAMPAIGN_DB);

        const collections = {
            profilesCollection: profileDb.collection('profiles'),
            friendListsCollection: profileDb.collection('friend_lists'),
            automationContactsCollection: profileDb.collection('automation_contacts'),
            pipelineStageContactsCollection: profileDb.collection('pipeline_stage_contacts'),
            pipelinesCollection: profileDb.collection('pipelines'),
            pipelineStagesCollection: profileDb.collection('pipeline_stages'),
            friendsQueueCollection: profileDb.collection('friends_queue'),
            activityCollection: profileDb.collection('activity'),
            friendCampaignsCollection: campaignDb.collection(FRIEND_CAMPAIGNS_COLLECTION),
            campaignsCollection: campaignDb.collection(CAMPAIGNS_COLLECTION),
        };

        const profileQuery = {
            fb_auth_info: { $ne: null },
            fb_user_id: { $ne: null },
            user_id: { $ne: null },
        };

        if (targetUserId.length > 0) {
            profileQuery.user_id = { $in: targetUserId };
        }

        const profiles = await collections.profilesCollection
            .find(profileQuery)
            .project({ user_id: 1, fb_user_id: 1 })
            .sort({ user_id: 1 })
            .toArray();

        console.log(`Found ${profiles.length} profile(s) to process.`);

        for (const profile of profiles) {
            await removeBlacklistedContactsForProfile({
                profile,
                collections,
                stats,
            });
        }

        console.log('Done.', stats);
    } catch (error) {
        console.error('Error:', error);
        throw error;
    } finally {
        await client.close();
    }
}

runRemoveBlacklistedContactsScript().catch(console.error);
 