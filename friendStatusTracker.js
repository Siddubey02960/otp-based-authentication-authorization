/**
 * friendStatusTracker script
 * Gets all profiles, finds friend_lists where friendStatus is "Non friend"
 * and document has friendFbId and fb_user_id, then adds those to the activity collection.
 */

const { MongoClient } = require('mongodb');
require('dotenv').config();

// Use env or fallback to a connection string (override in .env for your environment)
const uri = 'mongodb+srv://FR_SECRET_DEV:KxZLWdg5dwOfGB1i@cluster0.u2quf8g.mongodb.net/';

//const uri = 'mongodb+srv://FR_SECRET_READ_BETA:wjbQ3Pr1ZUPeDZ46@fr-frlst-beta.qricz.mongodb.net/'
const dbName = 'fr_profile';

// Activity types and actions (aligned with helper.js / friendStatusTracker)
const ACTIVITY_TYPE_FRIEND_STATUS_CHANGED = 17;
const ACTION_UPDATED = 3;

async function runFriendStatusTracker() {
    const client = new MongoClient(uri, {
        useNewUrlParser: true,
        useUnifiedTopology: true,
        serverSelectionTimeoutMS: 30000,
    });

    try {
        await client.connect();
        const database = client.db(dbName);
        const profilesCollection = database.collection('profiles');
        const friendListsCollection = database.collection('friend_lists');
        const activityCollection = database.collection('activity');

        // 1. Get all profiles (with fb_user_id and user_id)
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

        let totalInserted = 0;

        for (const profile of profiles) {
            const { user_id, fb_user_id } = profile;

            // 2. Get friend_lists where friendStatus is "Non friend" and has friendFbId (doc already has user_id, fb_user_id from profile)
            const nonFriendRecords = await friendListsCollection
                .find({
                    user_id,
                    fb_user_id,
                    friendStatus: 'Non friend',
                    friendFbId: { $exists: true, $nin: [null, ''] },
                })
                .toArray();

            if (nonFriendRecords.length === 0) continue;

            const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
            const activityRecords = nonFriendRecords.map((doc) => {
                const record = {
                    user_id,
                    fb_user_id,
                    created_at: doc.created_at,
                    activity_type: 17,
                    action: 3,
                    activity_info: {
                        oldValue: null,
                        newValue: 'Non friend',
                    },
                };
                //if (doc._id) record.friend_id = doc._id.toString();
                if (doc.friendFbId) record.friendFbId = doc.friendFbId.toString();
                return record;
            });

            await activityCollection.insertMany(activityRecords);
            totalInserted += activityRecords.length;
            console.log(`Profile user_id=${user_id}: added ${activityRecords.length} activity records (Non friend).`);
        }

        console.log(`Done. Total activity records inserted: ${totalInserted}.`);
    } catch (error) {
        console.error('Error:', error);
        throw error;
    } finally {
        await client.close();
    }
}

runFriendStatusTracker().catch(console.error);
