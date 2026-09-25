const { MongoClient } = require('mongodb');
require('dotenv').config();

const uri ='mongodb+srv://FR_SECRET_READ_BETA:wjbQ3Pr1ZUPeDZ46@fr-frlst-beta.qricz.mongodb.net/';
const dbName = 'fr_profile';

async function getQueueContactMapped() {
    const client = new MongoClient(uri, {
        useNewUrlParser: true,
        useUnifiedTopology: true,
        serverSelectionTimeoutMS: 30000,
    });

    try {
        await client.connect();
        console.log('Connected to MongoDB');

        const db = client.db(dbName);
        const profilesCollection = db.collection('profiles');
        const queueCollection = db.collection('friends_queue');
        const requestLogsCollection = db.collection('friend_request_send_logs');
        const friendListsCollection = db.collection('friend_lists');

        // First get profiles and only keep user_id + fb_user_id used for queue lookup.
        const profiles = await profilesCollection.find({
                fb_auth_info: { $ne: null },
                fb_user_id: { $ne: null },
            })
            .project({ _id: 0, user_id: 1, fb_user_id: 1 })
            .toArray();

        console.log(`Profiles found: ${profiles.length}`);

        let totalQueueRecords = 0;
        let totalUpdated = 0;

        for (const profile of profiles) {
            const { user_id, fb_user_id } = profile;

            const queueRecords = await queueCollection.find({
                    user_id,
                    fb_user_id,
                    is_active: true,
                    status: 1,
                })
                .toArray();

            if (!queueRecords.length) {
                console.log(`Profile user_id=${user_id}`);
                continue;
            }
            totalQueueRecords += queueRecords.length;

            const friendFbIds = queueRecords.map((record) => record.friendFbId?.toString?.() || '')
                .filter((id) => id);

            if (!friendFbIds.length) continue;

            const requestLogs = await requestLogsCollection
                .find({
                    user_id,
                    fb_user_id,
                    friendFbId: { $in: friendFbIds },
                    friendRequestStatus: { $in: ['Pending', 'Accepted', 'Rejected'] },
                })
                .sort({ created_at: -1 })
                .toArray();

            const friendListDocs = await friendListsCollection
                .find({
                    user_id,
                    fb_user_id,
                    friendFbId: { $in: friendFbIds },
                })
                .toArray();

            const latestStatusByFriendFbId = new Map();
            for (const log of requestLogs) {
                const friendFbId = log.friendFbId?.toString?.();
                if (!friendFbId || latestStatusByFriendFbId.has(friendFbId)) continue;

                if (log.friendRequestStatus === 'Pending') {
                    latestStatusByFriendFbId.set(friendFbId, 'Pending');
                } else if (log.friendRequestStatus === 'Accepted') {
                    latestStatusByFriendFbId.set(friendFbId, 'Friend');
                } else if (log.friendRequestStatus === 'Rejected') {
                    latestStatusByFriendFbId.set(friendFbId, 'Rejected');
                }
            }

            const friendListStatusByFriendFbId = new Map();
            for (const friendDoc of friendListDocs) {
                const friendFbId = friendDoc.friendFbId?.toString?.();
                if (!friendFbId) continue;

                if (friendDoc.friendStatus === 'Lost') {
                    friendListStatusByFriendFbId.set(friendFbId, 'Lost');
                    continue;
                }

                if (friendDoc.friendStatus === 'Activate') {
                    if (friendDoc.deleted_status === 1) {
                        friendListStatusByFriendFbId.set(friendFbId, 'Unfriend');
                    } else if (
                        friendDoc.deleted_status === 0 ||
                        friendDoc.deleted_status == null
                    ) {
                        friendListStatusByFriendFbId.set(friendFbId, 'Friend');
                    }
                }
            }

            const queueRecordIdByFriendFbId = new Map();
            for (const queueRecord of queueRecords) {
                const friendFbId = queueRecord.friendFbId?.toString?.();
                if (!friendFbId) continue;
                queueRecordIdByFriendFbId.set(friendFbId, queueRecord._id);
            }

            // Step 1: update from request logs.
            const logBasedUpdates = [];
            for (const queueRecord of queueRecords) {
                const friendFbId = queueRecord.friendFbId?.toString?.();
                if (!friendFbId) continue;

                const mappedStatus = latestStatusByFriendFbId.get(friendFbId);
                if (!mappedStatus) continue;

                logBasedUpdates.push({
                    updateOne: {
                        filter: { _id: queueRecord._id },
                        update: { $set: { friend_request_send_status: mappedStatus } },
                    },
                });
            }

            if (logBasedUpdates.length > 0) {
                const result = await queueCollection.bulkWrite(logBasedUpdates);
                totalUpdated += result.modifiedCount || 0;
            }

            // Step 2: update from friend_lists (overrides log-based status).
            const friendListBasedUpdates = [];
            for (const [friendFbId, mappedStatus] of friendListStatusByFriendFbId.entries()) {
                const queueRecordId = queueRecordIdByFriendFbId.get(friendFbId);
                if (!queueRecordId) continue;

                friendListBasedUpdates.push({
                    updateOne: {
                        filter: { _id: queueRecordId },
                        update: { $set: { friend_request_send_status: mappedStatus } },
                    },
                });
            }

            if (friendListBasedUpdates.length > 0) {
                const result = await queueCollection.bulkWrite(friendListBasedUpdates);
                totalUpdated += result.modifiedCount || 0;
            }

            console.log(
                `Profile user_id=${user_id}: log updates=${logBasedUpdates.length}, friend list overrides=${friendListBasedUpdates.length}.`
            );
        }

        console.log(`Queue records scanned: ${totalQueueRecords}`);
        console.log(`fr_queue records updated: ${totalUpdated}`);

        return { totalQueueRecords, totalUpdated };
    } catch (error) {
        console.error('Error while mapping queue contacts:', error);
        throw error;
    } finally {
        await client.close();
    }
}

getQueueContactMapped().catch(console.error);
 