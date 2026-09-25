/**
 * addCampaignContactTracker script
 *
 * Profile-wise backfill for `campaignContactTracker`:
 * - Reads campaign contacts from `fr_campaigns.campaign_contacts`
 * - For each `campaigns[]` entry:
 *   - If `created_at` exists: insert an "added to campaign" activity
 *   - If `deleted_at` exists: insert a "removed from campaign" activity
 *   - If both exist: inserts both (added first, removed second)
 * - Adds `campaign_name` by preloading all campaigns from `fr_campaigns.campaigns`
 *   (projection: `campaign_name`) and mapping by `campaign_id`.
 *
 * Output collection: `fr_profile.activity`
 */

const { MongoClient } = require('mongodb');
require('dotenv').config();

const uri =
    process.env.DATABASE_READ_HOST ||
    'mongodb+srv://FR_SECRET_DEV:KxZLWdg5dwOfGB1i@cluster0.u2quf8g.mongodb.net/';

const profileDbName = process.env.DATABASE_NAME || 'fr_profile';
const campaignDbName = 'fr_campaigns';

const ACTIVITY_TYPE_CAMPAIGN = 7;
const ACTION_ADDED = 1;
const ACTION_REMOVED = 2;

const BATCH_SIZE = 1000;

function toIdString(val) {
    if (val == null) return '';
    if (typeof val === 'string') return val;
    if (val && typeof val.toString === 'function') return val.toString();
    return '';
}

function toMysqlDatetimeString(val) {
    if (val == null) return '';
    if (typeof val === 'string') return val;
    if (val instanceof Date) {
        return val.toISOString().slice(0, 19).replace('T', ' ');
    }
    if (val && typeof val.toString === 'function') return val.toString();
    return '';
}

async function runCampaignContactTracker() {
    const client = new MongoClient(uri, {
        useNewUrlParser: true,
        useUnifiedTopology: true,
        serverSelectionTimeoutMS: 30000,
    });

    try {
        await client.connect();
        console.log('Connected to MongoDB');

        const profileDb = client.db(profileDbName);
        const campaignDb = client.db(campaignDbName);

        const profilesCollection = profileDb.collection('profiles');
        const activityCollection = profileDb.collection('activity');
        const campaignContactsCollection =
            campaignDb.collection('campaign_contacts');
        const campaignsCollection = campaignDb.collection('campaigns');

        // 1) Preload campaigns once: campaign_id -> campaign_name
        const campaigns = await campaignsCollection
            .find({}, { projection: { campaign_name: 1 } })
            .toArray();

        const campaignNameById = new Map();
        for (const campaign of campaigns) {
            const idStr = toIdString(campaign._id);
            const name =
                campaign?.campaign_name != null &&
                String(campaign.campaign_name).trim() !== ''
                    ? String(campaign.campaign_name).trim()
                    : '';
            if (idStr) campaignNameById.set(idStr, name);
        }

        // 2) Iterate profiles (profile-wise)
        const profiles = await profilesCollection
            .find({
                fb_auth_info: { $ne: null },
                fb_user_id: { $ne: null },
            })
            .project({ user_id: 1, fb_user_id: 1 })
            .sort({ user_id: 1 })
            .toArray();

        console.log(`Found ${profiles.length} profiles.`);

        let totalInserted = 0;

        for (const profile of profiles) {
            const { user_id, fb_user_id } = profile;

            const campaignContacts = await campaignContactsCollection
                .find({
                    user_id,
                    fb_user_id,
                    friendFbId: { $exists: true, $nin: [null, ''] },
                    campaigns: { $exists: true, $type: 'array', $ne: [] },
                })
                .project({ friendFbId: 1, campaigns: 1 })
                .toArray();

            if (campaignContacts.length === 0) continue;

            let profileInserted = 0;
            let pendingBatch = [];

            for (const contact of campaignContacts) {
                const friendFbId = toIdString(contact.friendFbId);
                if (!friendFbId) continue;

                const campaignsArray = Array.isArray(contact.campaigns)
                    ? contact.campaigns
                    : [];

                for (const campaignEntry of campaignsArray) {
                    const campaignIdStr = toIdString(campaignEntry?.campaign_id);
                    if (!campaignIdStr) continue;

                    const campaignName = campaignNameById.get(campaignIdStr) || '';
                    const createdAt = toMysqlDatetimeString(
                        campaignEntry?.created_at
                    );
                    const deletedAt = toMysqlDatetimeString(
                        campaignEntry?.deleted_at
                    );

                    if (createdAt) {
                        pendingBatch.push({
                            user_id,
                            fb_user_id,
                            created_at: createdAt,
                            activity_type: ACTIVITY_TYPE_CAMPAIGN,
                            action: ACTION_ADDED,
                            script: true,
                            campaign_id: campaignEntry.campaign_id,
                            campaign_name: campaignName,
                            friendFbId,
                        });
                    }

                    if (deletedAt) {
                        pendingBatch.push({
                            user_id,
                            fb_user_id,
                            created_at: deletedAt,
                            activity_type: ACTIVITY_TYPE_CAMPAIGN,
                            action: ACTION_REMOVED,
                            script: true,
                            campaign_id: campaignEntry.campaign_id,
                            campaign_name: campaignName,
                            friendFbId,
                        });
                    }

                    if (pendingBatch.length >= BATCH_SIZE) {
                        await activityCollection.insertMany(pendingBatch);
                        totalInserted += pendingBatch.length;
                        profileInserted += pendingBatch.length;
                        pendingBatch = [];
                    }
                }
            }

            if (pendingBatch.length > 0) {
                await activityCollection.insertMany(pendingBatch);
                totalInserted += pendingBatch.length;
                profileInserted += pendingBatch.length;
            }

            if (profileInserted > 0) {
                console.log(
                    `Profile user_id=${user_id}: inserted ${profileInserted} campaign activity records.`
                );
            }
        }

        console.log(
            `Done. Total campaign activity records inserted: ${totalInserted}.`
        );
    } catch (error) {
        console.error('Error:', error);
        throw error;
    } finally {
        await client.close();
    }
}

runCampaignContactTracker().catch(console.error);

