/**
 * Add campaign_name to activity type 7 (campaign) documents where only campaign_id is present.
 * Ignores documents that already have campaign_name.
 *
 * Runs profile-wise (like other scripts), keeping batch processing inside each profile.
 * For each profile:
 * - loads campaigns (from fr_campaigns.campaigns) into an in-memory map (once per profile)
 * - scans that profile's activity type 7 documents in batches and fills campaign_name
 */

const { MongoClient, ObjectId } = require('mongodb');
require('dotenv').config();

const uri = 'mongodb+srv://FR_SECRET_READ_BETA:wjbQ3Pr1ZUPeDZ46@fr-frlst-beta.qricz.mongodb.net/';
//const uri = 'mongodb+srv://FR_SECRET_READ_BETA:wjbQ3Pr1ZUPeDZ46@fr-frlst-beta.qricz.mongodb.net/'

const profileDbName = process.env.DATABASE_NAME || 'fr_profile';
const campaignDbName = 'fr_campaigns';

const ACTIVITY_TYPE_CAMPAIGN = 7;
const BATCH_SIZE = 1000;

/** Field in campaigns collection that holds the campaign name */
const CAMPAIGN_NAME_FIELD = 'campaign_name'; // or 'campaign_name' / 'title' if your schema differs

/** Normalize campaign_id to string for lookup (handles ObjectId or string). */
function toCampaignIdString(val) {
    if (val == null) return '';
    if (typeof val === 'string') return val;
    if (val && typeof val.toString === 'function') return val.toString();
    return '';
}

async function run() {
    const client = new MongoClient(uri, {
        useNewUrlParser: true,
        useUnifiedTopology: true,
        serverSelectionTimeoutMS: 30000,
    });

    try {
        await client.connect();
        const profileDb = client.db(profileDbName);
        const campaignDb = client.db(campaignDbName);
        const profilesCollection = profileDb.collection('profiles');
        const activityCollection = profileDb.collection('activity');
        const campaignsCollection = campaignDb.collection('campaigns');

        let totalUpdated = 0;

        const profiles = await profilesCollection
            .find({
                user_id: { $ne: null },
                fb_auth_info: { $ne: null },
                fb_user_id: { $ne: null },
            })
            .project({ user_id: 1, fb_user_id: 1 })
            .sort({ user_id: 1 })
            .toArray();

        console.log(`Found ${profiles.length} profiles.`);

        for (const profile of profiles) {
            const { user_id, fb_user_id } = profile;

            // 1) Load campaigns into map (once per profile; campaigns are not per-profile but this keeps the structure consistent)
            const campaigns = await campaignsCollection
                .find({}, { projection: { [CAMPAIGN_NAME_FIELD]: 1 } })
                .toArray();

            const campaignNameMap = new Map();
            for (const campaign of campaigns) {
                const idStr = campaign._id.toString();
                const name =
                    campaign[CAMPAIGN_NAME_FIELD] != null &&
                    String(campaign[CAMPAIGN_NAME_FIELD]).trim() !== ''
                        ? String(campaign[CAMPAIGN_NAME_FIELD]).trim()
                        : '';
                campaignNameMap.set(idStr, name);
            }

            let profileUpdated = 0;
            let batchIndex = 0;

            // 2) Process activity type 7 for this profile in batches
            const activityQuery = {
                user_id,
                fb_user_id,
                activity_type: ACTIVITY_TYPE_CAMPAIGN,
                campaign_id: { $exists: true, $ne: null },
                $or: [
                    { campaign_name: { $exists: false } },
                    { campaign_name: null },
                    { campaign_name: '' },
                ],
            };

            while (true) {
                const skip = batchIndex * BATCH_SIZE;
                const activities = await activityCollection
                    .find(activityQuery)
                    .skip(skip)
                    .limit(BATCH_SIZE)
                    .toArray();

                if (activities.length === 0) {
                    break;
                }

                console.log(`Profile user_id=${user_id} batch ${batchIndex + 1}: fetched ${activities.length} documents (skip=${skip}).`);

                let batchUpdated = 0;
                for (const activity of activities) {
                    const campaignIdRaw = activity.campaign_id;
                    const campaignIdStr =
                        campaignIdRaw && typeof campaignIdRaw.toString === 'function'
                            ? campaignIdRaw.toString()
                            : '';

                    const campaignName =
                        campaignIdStr && campaignNameMap.has(campaignIdStr)
                            ? campaignNameMap.get(campaignIdStr)
                            : '';

                    await activityCollection.updateOne(
                        { _id: activity._id },
                        { $set: { campaign_name: campaignName || '', script2: true } }
                    );
                    batchUpdated++;
                }

                profileUpdated += batchUpdated;
                totalUpdated += batchUpdated;
                console.log(`Profile user_id=${user_id} batch ${batchIndex + 1}: updated ${batchUpdated} of ${activities.length}. Profile total: ${profileUpdated}. Global total: ${totalUpdated}.`);

                if (activities.length < BATCH_SIZE) {
                    break;
                }
                batchIndex++;
            }

            if (profileUpdated > 0) {
                console.log(`Profile user_id=${user_id}: updated ${profileUpdated} campaign activity records.`);
            }
        }

        console.log(
            `Done. Total activity type 7 records updated with campaign_name: ${totalUpdated}.`
        );
    } catch (error) {
        console.error('Error:', error);
        throw error;
    } finally {
        await client.close();
    }
}

run().catch(console.error);
