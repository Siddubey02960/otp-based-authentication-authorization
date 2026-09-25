/**
 * Fix activity docs where fb_user_id incorrectly equals friendFbId.
 *
 * Profile-wise:
 * 1. Load all profiles
 * 2. For each profile, find activity records where:
 *      user_id = profile.user_id
 *      $expr: { $eq: ["$fb_user_id", "$friendFbId"] }
 *      fb_user_id != profile.fb_user_id
 * 3. Update those activity docs: set fb_user_id = profile.fb_user_id
 *
 * HOW TO RUN
 * ----------
 *   node previous_scripts/fixActivityFbUserIdMismatch.js
 *
 * Optional:
 *   Set TARGET_USER_IDS below to limit to specific profiles.
 */

const { MongoClient } = require('mongodb');
require('dotenv').config();

// const uri = 'mongodb+srv://FR_SECRET_DEV:KxZLWdg5dwOfGB1i@cluster0.u2quf8g.mongodb.net/';
const uri = 'mongodb+srv://FR_SECRET_READ_BETA:wjbQ3Pr1ZUPeDZ46@fr-frlst-beta.qricz.mongodb.net/';

const PROFILE_DB = process.env.DATABASE_NAME || 'fr_profile';
const BATCH_SIZE = 500;

/** Leave empty to process all profiles. Example: [1909, 1914] */
const TARGET_USER_IDS = [];

async function processProfile({ profile, activityCollection, stats }) {
    const userId = Number(profile.user_id);
    const currentFbUserId = String(profile.fb_user_id);

    const query = {
        user_id: userId,
        fb_user_id: { $ne: currentFbUserId },
        // friendFbId: { $exists: true, $nin: [null, ''] },
        $expr: {
            $eq: ['$fb_user_id', '$friendFbId'],
        },
    };

    // if(user_id == 1909 || user_id == 1914){
    //     break;
    // }

    let profileMatched = 0;
    let profileUpdated = 0;
    let batchIndex = 0;
    let lastId = null;

    while (true) {
        const batchQuery = { ...query };
        if (lastId) {
            batchQuery._id = { $gt: lastId };
        }

        const activities = await activityCollection
            .find(batchQuery)
            .project({ _id: 1, fb_user_id: 1, friendFbId: 1 })
            .sort({ _id: 1 })
            .limit(BATCH_SIZE)
            .toArray();

        if (!activities.length) {
            break;
        }

        batchIndex += 1;
        profileMatched += activities.length;
        lastId = activities[activities.length - 1]._id;

        const ids = activities.map((doc) => doc._id);
        const result = await activityCollection.updateMany(
            { _id: { $in: ids } },
            { $set: { fb_user_id: currentFbUserId } }
        ); 

        const updated = result.modifiedCount || 0;
        profileUpdated += updated;
        stats.totalMatched += activities.length;
        stats.totalUpdated += updated;

        console.log(
            `user_id=${userId} batch=${batchIndex}: matched=${activities.length}, updated=${updated}, set fb_user_id=${currentFbUserId}`
        );

        if (activities.length < BATCH_SIZE) {
            break;
        }
    }

    if (profileMatched > 0) {
        stats.profilesWithMismatch += 1;
        console.log(
            `Finished user_id=${userId}: matched=${profileMatched}, updated=${profileUpdated}`
        );
    }
}

async function run() {
    const client = new MongoClient(uri, {
        useNewUrlParser: true,
        useUnifiedTopology: true,
        serverSelectionTimeoutMS: 30000,
    });

    const stats = {
        profilesWithMismatch: 0,
        totalMatched: 0,
        totalUpdated: 0,
    };

    try {
        await client.connect();
        console.log('Connected to MongoDB');

        const db = client.db(PROFILE_DB);
        const profilesCollection = db.collection('profiles');
        const activityCollection = db.collection('activity');

        const profileQuery = {
            user_id: { $nin: [1909, 1914] },
            fb_user_id: { $ne: null },
            fb_auth_info: { $ne: null },
        };

        if (TARGET_USER_IDS.length) {
            profileQuery.user_id = { $in: TARGET_USER_IDS };
        }

        const profiles = await profilesCollection
            .find(profileQuery)
            .project({ user_id: 1, fb_user_id: 1 })
            .sort({ user_id: 1 })
            .toArray();

        console.log(`Found ${profiles.length} profile(s).`);

        for (const profile of profiles) {
            await processProfile({
                profile,
                activityCollection,
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

run().catch(console.error);
