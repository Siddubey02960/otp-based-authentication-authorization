/**
 * Attach friend_lists fields onto activity documents.
 *
 * Profile-wise:
 * 1. Load all profiles
 * 2. For each profile, read activity in batches of 500
 * 3. Collect friend_id / friendFbId from each activity batch
 * 4. Lookup friend_lists by:
 *    - _id = ObjectId(friend_id)
 *    - and/or user_id + fb_user_id + friendFbId
 * 5. Attach friendName, friendProfilePicture, friendProfileUrl,
 *    hide_dashboard_activity onto matching activity docs
 *
 * HOW TO RUN
 * ----------
 *   node previous_scripts/attachFriendDataToActivity.js
 *
 * Optional:
 *   Set TARGET_USER_IDS below to limit to specific profiles.
 */

const { MongoClient, ObjectId } = require('mongodb');
require('dotenv').config();

const uri = 'mongodb+srv://FR_SECRET_DEV:KxZLWdg5dwOfGB1i@cluster0.u2quf8g.mongodb.net/';
// const uri ='mongodb+srv://FR_SECRET_READ_BETA:wjbQ3Pr1ZUPeDZ46@fr-frlst-beta.qricz.mongodb.net/';

const PROFILE_DB = process.env.DATABASE_NAME || 'fr_profile';
const BATCH_SIZE = 5000; 

/** Leave empty to process all profiles. Example: [1909, 1914] */
const TARGET_USER_IDS = [];

function toIdString(val) {
    if (val == null) return '';
    if (typeof val === 'string') return val;
    if (val instanceof ObjectId) return val.toString();
    if (typeof val.toString === 'function') return val.toString();
    return '';
}

function toObjectId(id) {
    if (id instanceof ObjectId) return id;
    if (ObjectId.isValid(String(id))) return new ObjectId(String(id));
    return null;
}

function buildFriendLookupMaps(friendDocs) {
    const byId = new Map();
    const byFriendFbId = new Map();

    for (const friend of friendDocs) {
        const idStr = toIdString(friend._id);
        const friendFbId = friend.friendFbId != null ? String(friend.friendFbId) : '';

        const payload = {
            friendName: friend.friendName ?? '',
            friendProfilePicture: friend.friendProfilePicture ?? '',
            friendProfileUrl: friend.friendProfileUrl ?? '',
            hide_dashboard_activity: friend.hide_dashboard_activity ?? false,
        };

        if (idStr) byId.set(idStr, payload);
        if (friendFbId) byFriendFbId.set(friendFbId, payload);
    }

    return { byId, byFriendFbId };
}

function resolveFriendData(activity, byId, byFriendFbId) {
    const friendIdStr = toIdString(activity.friend_id);
    const friendFbId =
        activity.friendFbId != null && String(activity.friendFbId).trim() !== ''
            ? String(activity.friendFbId)
            : '';

    if (friendIdStr && byId.has(friendIdStr)) {
        return byId.get(friendIdStr);
    }
    if (friendFbId && byFriendFbId.has(friendFbId)) {
        return byFriendFbId.get(friendFbId);
    }
    return null;
}

async function processProfile({ profile, activityCollection, friendListsCollection, stats }) {
    const userId = Number(profile.user_id);
    const fbUserId = String(profile.fb_user_id);

    let lastId = null;
    let profileUpdated = 0;
    let profileScanned = 0;
    let batchIndex = 0;

    while (true) {
        const query = {
            user_id: userId,
            fb_user_id: fbUserId,
            $or: [
                { friend_id: { $exists: true, $nin: [null, ''] } },
                { friendFbId: { $exists: true, $nin: [null, ''] } },
            ],
        };

        if (lastId) {
            query._id = { $gt: lastId };
        }

        const activities = await activityCollection
            .find(query)
            .sort({ _id: 1 })
            .limit(BATCH_SIZE)
            .toArray();

        if (!activities.length) {
            break;
        }

        batchIndex += 1;
        profileScanned += activities.length;
        lastId = activities[activities.length - 1]._id;

        const friendObjectIds = [];
        const friendFbIds = [];

        for (const activity of activities) {
            const friendObjectId = toObjectId(activity.friend_id);
            if (friendObjectId) {
                friendObjectIds.push(friendObjectId);
            }

            if (activity.friendFbId != null && String(activity.friendFbId).trim() !== '') {
                friendFbIds.push(String(activity.friendFbId));
            }
        }

        const uniqueFriendObjectIds = [...new Set(friendObjectIds.map((id) => id.toString()))].map(
            (id) => new ObjectId(id)
        );
        const uniqueFriendFbIds = [...new Set(friendFbIds)];

        const orClauses = [];
        if (uniqueFriendObjectIds.length) {
            orClauses.push({ _id: { $in: uniqueFriendObjectIds } });
        }
        if (uniqueFriendFbIds.length) {
            orClauses.push({
                user_id: userId,
                fb_user_id: fbUserId,
                friendFbId: { $in: uniqueFriendFbIds },
            });
        }

        let friendDocs = [];
        if (orClauses.length) {
            friendDocs = await friendListsCollection
                .find({ $or: orClauses })
                .project({
                    friendFbId: 1,
                    friendName: 1,
                    friendProfilePicture: 1,
                    friendProfileUrl: 1,
                    hide_dashboard_activity: 1,
                })
                .toArray();
        }

        const { byId, byFriendFbId } = buildFriendLookupMaps(friendDocs);
        const bulkOps = [];

        for (const activity of activities) {
            const friendData = resolveFriendData(activity, byId, byFriendFbId);
            if (!friendData) continue;

            bulkOps.push({
                updateOne: {
                    filter: { _id: activity._id },
                    update: {
                        $set: {
                            friendName: friendData.friendName,
                            friendProfilePicture: friendData.friendProfilePicture,
                            friendProfileUrl: friendData.friendProfileUrl,
                            hide_dashboard_activity: friendData.hide_dashboard_activity,
                        },
                    },
                },
            });
        }

        if (bulkOps.length) {
            const result = await activityCollection.bulkWrite(bulkOps, { ordered: false });
            const updated = result.modifiedCount || bulkOps.length;
            profileUpdated += updated;
            stats.totalUpdated += updated;
        }

        console.log(
            `user_id=${userId} batch=${batchIndex}: scanned=${activities.length}, matchedFriends=${friendDocs.length}, updates=${bulkOps.length}`
        );

        if (activities.length < BATCH_SIZE) {
            break;
        }
    }

    if (profileScanned > 0) {
        stats.profilesWithActivity += 1;
        console.log(
            `Finished user_id=${userId}: scanned=${profileScanned}, updated=${profileUpdated}`
        );
    }

    stats.totalScanned += profileScanned;
}

async function run() {
    const client = new MongoClient(uri, {
        useNewUrlParser: true,
        useUnifiedTopology: true,
        serverSelectionTimeoutMS: 30000,
    });

    const stats = {
        profilesWithActivity: 0,
        totalScanned: 0,
        totalUpdated: 0,
    };

    try {
        await client.connect();
        console.log('Connected to MongoDB');

        const db = client.db(PROFILE_DB);
        const profilesCollection = db.collection('profiles');
        const activityCollection = db.collection('activity');
        const friendListsCollection = db.collection('friend_lists');

        const profileQuery = {
            user_id: { $eq: 1909 },
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
                friendListsCollection,
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
