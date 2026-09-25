/**
 * addFriendRequestTrackerFromLogs script
 *
 * Source:
 *   DB: fr_profile
 *   Collection: friend_request_send_logs
 *
 * Base condition:
 *   {
 *     friendFbId: { $nin: [null, ""] },
 *     is_incoming: { $ne: true },
 *     friendRequestStatus: { $in: ["Accepted", "Pending"] }
 *   }
 *
 * For each matching log (profile-wise):
 *   - Add friendRequestSent (activity_type 14)
 *       created_at = doc.created_at
 *   - If status is "Accepted" and accepted_at is present:
 *       Add friendRequestAccepted (activity_type 15)
 *       created_at = doc.accepted_at
 *
 * All inserted records include script: true.
 *
 * Output collection: `fr_profile.activity`
 */
const { MongoClient } = require('mongodb');
require('dotenv').config();

const uri =
    process.env.DATABASE_READ_HOST ||
    'mongodb+srv://FR_SECRET_DEV:KxZLWdg5dwOfGB1i@cluster0.u2quf8g.mongodb.net/';

const dbName = process.env.DATABASE_NAME || 'fr_profile';

const ACTIVITY_TYPE_FRIEND_REQUEST_SENT = 14;
const ACTIVITY_TYPE_FRIEND_REQUEST_ACCEPTED = 15;
const ACTION_ADDED = 1;

const BATCH_SIZE = 1000;

function nowSql() {
    return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

function isNonEmpty(val) {
    return val != null && String(val).trim() !== '';
}

async function run() {
    const client = new MongoClient(uri, {
        useNewUrlParser: true,
        useUnifiedTopology: true,
        serverSelectionTimeoutMS: 30000,
    });

    const targetUserId = process.env.TARGET_USER_ID
        ? Number(process.env.TARGET_USER_ID)
        : null;

    try {
        await client.connect();
        const database = client.db(dbName);
        const profilesCollection = database.collection('profiles');
        const logsCollection = database.collection('friend_request_send_logs');
        const activityCollection = database.collection('activity');

        const profileQuery = {
            // user_id: 1909,
            fb_auth_info: { $ne: null },
            fb_user_id: { $ne: null },
        };
        if (Number.isFinite(targetUserId)) {
            profileQuery.user_id = targetUserId;
        }

        const profiles = await profilesCollection
            .find(profileQuery)
            .project({ user_id: 1, fb_user_id: 1 })
            .sort({ user_id: 1 })
            .toArray();

        console.log(`Found ${profiles.length} profiles.`);

        let totalInserted = 0;

        for (const profile of profiles) {
            const { user_id, fb_user_id } = profile;

            const cursor = logsCollection.find({
                user_id,
                fb_user_id,
                friendFbId: { $nin: [null, ''] },
                is_incoming: { $ne: true },
                friendRequestStatus: { $in: ['Accepted', 'Pending'] },
            });

            let batch = [];
            let profileInserted = 0;

            while (await cursor.hasNext()) {
                const doc = await cursor.next();

                const friendFbId = doc.friendFbId?.toString?.() ?? null;
                if (!friendFbId) continue;

                const sentAt = doc.created_at || nowSql();
                const status = doc.friendRequestStatus || null;

                // Friend request sent
                batch.push({
                    user_id,
                    fb_user_id,
                    created_at: sentAt,
                    activity_type: ACTIVITY_TYPE_FRIEND_REQUEST_SENT,
                    action: ACTION_ADDED,
                    script12: true ,
                    friendFbId
                });

                // Friend request accepted (only when accepted + accepted_at present)
                if (
                    status === 'Accepted' &&
                    isNonEmpty(doc.accepted_at)
                ) {
                    batch.push({
                        user_id,
                        fb_user_id,
                        created_at: doc.accepted_at,
                        activity_type: ACTIVITY_TYPE_FRIEND_REQUEST_ACCEPTED,
                        action: ACTION_ADDED,
                        script12: true,
                        friendFbId
                    });
                }

                if (batch.length >= BATCH_SIZE) {
                    await activityCollection.insertMany(batch);
                    totalInserted += batch.length;
                    profileInserted += batch.length;
                    batch = [];
                }
            }

            if (batch.length > 0) {
                await activityCollection.insertMany(batch);
                totalInserted += batch.length;
                profileInserted += batch.length;
            }

            if (profileInserted > 0) {
                console.log(
                    `Profile user_id=${user_id}: inserted ${profileInserted} friend-request activity records.`
                );
            }
        }

        console.log(
            `Done. Total friend-request activity records inserted: ${totalInserted}.`
        );
    } catch (error) {
        console.error('Error:', error);
        throw error;
    } finally {
        await client.close();
    }
}

run().catch(console.error);

