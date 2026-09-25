/**
 * addMessageTracker script
 * Gets data from the message_send_logs collection from fr_messages db
 * and adds those to the activity collection in fr_profile db.
 */

const { MongoClient } = require('mongodb');
require('dotenv').config();

// Connection URI
//const uri = 'mongodb+srv://FR_SECRET_DEV:KxZLWdg5dwOfGB1i@cluster0.u2quf8g.mongodb.net/';

const uri = 'mongodb+srv://FR_SECRET_READ_BETA:wjbQ3Pr1ZUPeDZ46@fr-frlst-beta.qricz.mongodb.net/'

/** Normalize campaign_id to string for lookup (handles ObjectId or string). */
function toCampaignIdString(val) {
    if (val == null) return '';
    if (typeof val === 'string') return val;
    if (val && typeof val.toString === 'function') return val.toString();
    return '';
}

async function runMessageTrackerScript() {
    const client = new MongoClient(uri, {
        useNewUrlParser: true,
        useUnifiedTopology: true,
    });

    try {
        await client.connect();
        console.log("Connected to MongoDB");

        const messagesDb = client.db('fr_messages');
        const profileDb = client.db('fr_profile');
        const campaignDb = client.db('fr_campaigns');

        const messageLogsCollection = messagesDb.collection('message_send_logs');
        const activityCollection = profileDb.collection('activity');
        const campaignsCollection = campaignDb.collection('campaigns');

        // Fetch all message logs (cursor to handle large datasets)
        // We'll do two passes:
        // 1) Collect unique campaign ids and prefetch campaigns in one query.
        // 2) Stream logs again and build activity documents using the prefetched map.

        let totalProcessed = 0;
        let batch = [];
        const batchSize = 1000;

        console.log("Starting to process message logs...");

        // Load all campaigns once (same strategy as addCampaignNameToActivityType7.js).
        const campaigns = await campaignsCollection
            .find({}, { projection: { campaign_name: 1 } })
            .toArray();
        const campaignNameById = new Map();
        for (const c of campaigns) {
            const idStr = toCampaignIdString(c?._id);
            if (idStr) {
                campaignNameById.set(idStr, c?.campaign_name || '');
            }
        }

        // Pass 2: stream full logs and insert activity
        const cursor2 = messageLogsCollection.find({});
        while (await cursor2.hasNext()) {
            const log = await cursor2.next();

            // Mapping based on helper.js (542-552)
            const activityData = {
                user_id: log.user_id,
                fb_user_id: log.fb_user_id,
                created_at: log.created_at || new Date().toISOString().slice(0, 19).replace("T", " "),
                activity_type: 8,
                action: log.status === 'send' ? 7 : 9,
                friendFbId: log.friendFbId,
                message: log.message,
                setting_type: log.settings_type,
                status: log.status,
                images: log.images_data,
                script5: true
            };

            // Copy all additional fields from log except:
            // - fields already mapped above
            // - log timestamps we do not want to carry forward
            // - MongoDB internal id
            const skipLogFields = new Set([
                '_id',
                'created_at',
                'updated_at',
                'user_id',
                'fb_user_id',
                'friendFbId',
                'message',
                'settings_type',
                'status',
                'images_data'
            ]);
            for (const [key, value] of Object.entries(log)) {
                if (skipLogFields.has(key)) continue;
                if (activityData[key] !== undefined) continue;
                activityData[key] = value;
            }

            // Optional: check for campaign_id if it exists in log
            if (log.campaign_id) {
                // Keep original field name used by previous runs (typo kept for compatibility)
                activityData.campiagn_id = log.campaign_id;
                const idStr = toCampaignIdString(log.campaign_id);
                if (idStr && campaignNameById.has(idStr)) {
                    activityData.campaign_name = campaignNameById.get(idStr) || '';
                }
            }

            batch.push(activityData);

            if (batch.length >= batchSize) {
                await activityCollection.insertMany(batch);
                totalProcessed += batch.length;
                console.log(`Inserted ${totalProcessed} records...`);
                batch = [];
            }
        }

        // Insert remaining records
        if (batch.length > 0) {
            await activityCollection.insertMany(batch);
            totalProcessed += batch.length;
        }

        console.log(`Done. Total records added to activity: ${totalProcessed}`);

    } catch (error) {
        console.error('Error:', error);
    } finally {
        await client.close();
    }
}

runMessageTrackerScript().catch(console.error);
