/**
 * addQueueTracker script
 * Profile-wise: for each profile, reads friends_queue (user_id, fb_user_id, status),
 * and inserts corresponding activity records (activity_type: queue, action: added or removed if _is_active is false)
 * into the activity collection in fr_profile db.
 * Mirrors helper.js queueTracker logic for backfill.
 */

const { MongoClient } = require('mongodb');
require('dotenv').config();

const uri ='mongodb+srv://FR_SECRET_READ_BETA:wjbQ3Pr1ZUPeDZ46@fr-frlst-beta.qricz.mongodb.net/';

const dbName = 'fr_profile';

const ACTIVITY_TYPE_QUEUE = 13;
const ACTION_ADDED = 1;
const ACTION_REMOVED = 2;

async function runQueueTracker() {
    const client = new MongoClient(uri, {
        useNewUrlParser: true,
        useUnifiedTopology: true,
        serverSelectionTimeoutMS: 30000,
    });

    try {
        await client.connect();
        const database = client.db(dbName);
        const profilesCollection = database.collection('profiles');
        const friendsQueueCollection = database.collection('friends_queue');
        const activityCollection = database.collection('activity');

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

            const queueRecords = await friendsQueueCollection
                .find({
                    user_id,
                    fb_user_id,
                    status: 1,
                    friendFbId:{$nin: [null, '']}
                })
                .toArray();

            if (queueRecords.length === 0) continue;

            const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
            const activityRecords = [];

            for (const doc of queueRecords) {
                const friendId = (doc.friendFbId ?? doc.friend_id)?.toString?.() ?? null;
                if (!friendId) continue;

                const action = doc._is_active === false ? ACTION_REMOVED : ACTION_ADDED;

                activityRecords.push({
                    user_id,
                    fb_user_id,
                    created_at: doc.created_at || now,
                    activity_type: ACTIVITY_TYPE_QUEUE,
                    action,
                    script6: true,
                    friend_id: friendId,
                });
            }

            if (activityRecords.length > 0) {
                await activityCollection.insertMany(activityRecords);
                totalInserted += activityRecords.length;
                console.log(`Profile user_id=${user_id}: added ${activityRecords.length} queue activity records.`);
            }
        }

        console.log(`Done. Total queue activity records inserted: ${totalInserted}.`);
    } catch (error) {
        console.error('Error:', error);
        throw error;
    } finally {
        await client.close();
    }
}

runQueueTracker().catch(console.error);
