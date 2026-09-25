/**
 * Seed friends_queue with buddy host accounts (1909, 1914) for all other profiles.
 *
 * WHAT THIS SCRIPT DOES
 * ---------------------
 * For each profile (except buddy host user_ids 1909, 1914), attempt to add both
 * buddy host accounts into that user's friends_queue:
 *
 * 1. Skip if buddy fb_user_id is the profile's own fb_user_id.
 * 2. Skip if buddy already exists in friends_queue
 *    (is_active true, status in [null, 0, 2]).
 * 3. Skip if buddy exists in friend_lists with friendStatus other than "Non friend"
 *    ("Non friend" rows ARE eligible).
 * 4. Skip if buddy exists in pending_list.
 * 5. Otherwise insert into friends_queue with source / sourceName / finalSource = "buddy",
 *    and record queue activity (type 13, action added, location "buddy").
 *
 * HOW TO RUN
 * ----------
 * 1. Set `uri` to the target Mongo cluster.
 * 2. Optionally change BUDDY_HOST_ACCOUNTS / EXCLUDED_USER_IDS / BATCH_SIZE.
 * 3. Run:
 *
 *      node previous_scripts/add_buddy_in_fr_queue.js
 *
 * Requires: mongodb
 */

const { MongoClient } = require('mongodb');

// const uri = 'mongodb+srv://FR_SECRET_DEV:KxZLWdg5dwOfGB1i@cluster0.u2quf8g.mongodb.net/';
const uri = 'mongodb+srv://FR_SECRET_READ_BETA:wjbQ3Pr1ZUPeDZ46@fr-frlst-beta.qricz.mongodb.net/';

const EXCLUDED_USER_IDS = [1909, 1914];
const BUDDY_HOST_ACCOUNTS = [
    {
        user_id: 1909,
        fb_user_id: '100067189421485',
        profilePicture:
            'https://s3.amazonaws.com/beta.friender.io/profile/images/100067189421485.jpeg',
        profileUrl: 'https://www.facebook.com/100067189421485',
        name: 'Jon Vaughn',
    },
    {
        user_id: 1914,
        fb_user_id: '100000537972983',
        profilePicture:
            'https://s3.amazonaws.com/beta.friender.io/profile/images/100000537972983.jpeg',
        profileUrl: 'https://www.facebook.com/100000537972983',
        name: 'Aunkita Vaughn',
    },
];
const BATCH_SIZE = 500;
const SOURCE = 'buddy';
const ACTIVITY_TYPE_QUEUE = 13;
const ACTION_ADDED = 1;

function nowTimestamp() {
    return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

async function getUnlabeledLabelId(labelsCollection, { user_id, fb_user_id }) {
    const label = await labelsCollection.findOne({
        user_id: Number(user_id),
        fb_user_id: String(fb_user_id),
        title: 'Unlabeled',
        deleted_at: { $in: [null, ''] },
    });
    return label?._id ?? null;
}

async function getNextOrderId(friendsQueueCollection, { user_id, fb_user_id }) {
    const lowest = await friendsQueueCollection
        .aggregate([
            {
                $match: {
                    user_id: Number(user_id),
                    fb_user_id: String(fb_user_id),
                    is_active: true,
                },
            },
            { $group: { _id: null, minSortNumber: { $min: '$order_id' } } },
        ])
        .toArray();

    const minSortNum = lowest.length ? lowest[0].minSortNumber : 0;
    return minSortNum - 1;
}

function buildQueuePayload({
    userId,
    fbUserId,
    friendFbId,
    friendName,
    friendProfileUrl,
    friendProfilePicture,
    orderId,
    labelId,
    now,
}) {
    return {
        user_id: Number(userId),
        fb_user_id: String(fbUserId),
        settingsId: null,
        matchedKeyword: [],
        finalSource: SOURCE,
        friendFbId: String(friendFbId),
        order_id: orderId,
        friendProfileUrl: friendProfileUrl || '',
        friendName: friendName || '',
        friendProfilePicture: friendProfilePicture || '',
        friendStatus: 'Non friend',
        sourceUrl: friendProfileUrl || '',
        sourceName: SOURCE,
        source: SOURCE,
        actualSource: SOURCE,
        gender: 'UNKNOWN',
        country: '',
        is_active: true,
        status: null,
        tier: '',
        refriending: false,
        refriending_attempt: 0,
        refriending_used_keyword: '',
        refriending_pending_days: 0,
        refriending_max_attempts: 0,
        'added-to-friend-queue': 1,
        profile_viewed: 0,
        time_saved: '',
        message_group_request_sent: null,
        message_group_request_accepted: null,
        created_at: now,
        updated_at: now,
        label: labelId,
        tags: [],
        unmatched_filters: [],
        matched_filters: [],
    };
}

function buildQueueActivityPayload({
    userId,
    fbUserId,
    friendFbId,
    friendListId,
    now,
}) {
    const activity = {
        user_id: Number(userId),
        fb_user_id: String(fbUserId),
        created_at: now,
        activity_type: ACTIVITY_TYPE_QUEUE,
        action: ACTION_ADDED,
        friendFbId: String(friendFbId),
        location: SOURCE,
    };
    if (friendListId) {
        activity.friend_id = String(friendListId);
    }
    return activity;
}

async function insertManyBatched(collection, docs, label) {
    let inserted = 0;
    for (let i = 0; i < docs.length; i += BATCH_SIZE) {
        const batch = docs.slice(i, i + BATCH_SIZE);
        try {
            const result = await collection.insertMany(batch, { ordered: false });
            inserted += result.insertedCount || batch.length;
        } catch (err) {
            inserted += err?.result?.nInserted || err?.insertedCount || 0;
            console.error(`${label} batch error:`, err?.message || err);
        }
        console.log(
            `${label}: batch ${Math.floor(i / BATCH_SIZE) + 1} (${batch.length} docs)`
        );
    }
    return inserted;
}

async function seedBuddyHostsIntoFriendsQueue() {
    const client = new MongoClient(uri, {
        useNewUrlParser: true,
        useUnifiedTopology: true,
    });

    try {
        await client.connect();

        const database = client.db('fr_profile');
        const profileCollections = database.collection('profiles');
        const friendListsCollection = database.collection('friend_lists');
        const friendsQueueCollection = database.collection('friends_queue');
        const pendingListCollection = database.collection('friend_request_send_logs');
        const labelsCollection = database.collection('labels');
        const activityCollection = database.collection('activity');
        const now = nowTimestamp();

        const buddyFbIds = BUDDY_HOST_ACCOUNTS.map((buddy) => String(buddy.fb_user_id));

        const profiles = await profileCollections
            .aggregate([
                {
                    $match: {
                        user_id: { $nin: EXCLUDED_USER_IDS },
                        fb_user_id: { $ne: null },
                    },
                },
                {
                    $project: {
                        user_id: 1,
                        fb_user_id: 1,
                        name: 1,
                        profilePicture: 1,
                        profileUrl: 1,
                    },
                },
                { $sort: { user_id: 1 } },
            ])
            .toArray();

        console.log(`Found ${profiles.length} profiles (excluding ${EXCLUDED_USER_IDS.join(', ')})`);

        if (!profiles.length) {
            console.log('No profiles found. Exiting.');
            return;
        }

        for (const profile of profiles) {
            const userId = Number(profile.user_id);
            const fbUserId = String(profile.fb_user_id);

            console.log(`Processing user_id: ${userId}, fb_user_id: ${fbUserId}`);

            const [existingFriendLists, existingQueue, existingPendingList, labelId] =
                await Promise.all([
                    friendListsCollection
                        .find({
                            user_id: userId,
                            fb_user_id: fbUserId,
                            friendFbId: { $in: buddyFbIds },
                        })
                        .project({ _id: 1, friendFbId: 1, friendStatus: 1 })
                        .toArray(),
                    friendsQueueCollection
                        .find({
                            user_id: userId,
                            fb_user_id: fbUserId,
                            friendFbId: { $in: buddyFbIds },
                            is_active: true,
                            status: { $in: [null, 0, 2] },
                        })
                        .project({ friendFbId: 1 })
                        .toArray(),
                    pendingListCollection
                        .find({
                            user_id: userId,
                            fb_user_id: fbUserId,
                            friendFbId: { $in: buddyFbIds },
                        })
                        .project({ friendFbId: 1 })
                        .toArray(),
                    getUnlabeledLabelId(labelsCollection, {
                        user_id: userId,
                        fb_user_id: fbUserId,
                    }),
                ]);

            const blockedByFriendList = {};
            const nonFriendFriendListIds = {};
            for (const row of existingFriendLists) {
                if (row.friendFbId == null) continue;
                const id = String(row.friendFbId);
                if (row.friendStatus === 'Non friend') {
                    if (row._id) {
                        nonFriendFriendListIds[id] = row._id;
                    }
                    continue;
                }
                blockedByFriendList[id] = true;
            }

            const inQueue = {};
            for (const row of existingQueue) {
                if (row.friendFbId != null) inQueue[String(row.friendFbId)] = true;
            }

            const inPendingList = {};
            for (const row of existingPendingList) {
                if (row.friendFbId != null) inPendingList[String(row.friendFbId)] = true;
            }

            console.log(
                `Existing maps for user_id ${userId}: blockedFriendList=${Object.keys(blockedByFriendList).length}, friends_queue=${Object.keys(inQueue).length}, pending_list=${Object.keys(inPendingList).length}`
            );

            let orderId = await getNextOrderId(friendsQueueCollection, {
                user_id: userId,
                fb_user_id: fbUserId,
            });

            const queueDocs = [];
            const activityDocs = [];
            let skippedSelf = 0;
            let skippedFriendList = 0;
            let skippedQueue = 0;
            let skippedPendingList = 0;

            for (const buddy of BUDDY_HOST_ACCOUNTS) {
                const friendFbId = String(buddy.fb_user_id);

                if (friendFbId === fbUserId) {
                    skippedSelf += 1;
                    continue;
                }
                if (blockedByFriendList[friendFbId]) {
                    skippedFriendList += 1;
                    continue;
                }
                if (inQueue[friendFbId]) {
                    skippedQueue += 1;
                    continue;
                }
                if (inPendingList[friendFbId]) {
                    skippedPendingList += 1;
                    continue;
                }

                queueDocs.push(
                    buildQueuePayload({
                        userId,
                        fbUserId,
                        friendFbId,
                        friendName: buddy.name,
                        friendProfileUrl: buddy.profileUrl,
                        friendProfilePicture: buddy.profilePicture,
                        orderId,
                        labelId,
                        now,
                    })
                );

                activityDocs.push(
                    buildQueueActivityPayload({
                        userId,
                        fbUserId,
                        friendFbId,
                        friendListId: nonFriendFriendListIds[friendFbId],
                        now,
                    })
                );

                console.log(
                    `[friends_queue insert] owner_user_id=${userId} owner_fb_user_id=${fbUserId} buddy_user_id=${buddy.user_id} friendFbId=${friendFbId} friendName=${buddy.name} order_id=${orderId} source=${SOURCE}`
                );

                orderId -= 1;
            }

            console.log(
                `Eligibility for user_id ${userId}: toInsert=${queueDocs.length}, skippedSelf=${skippedSelf}, skippedFriendList(non-NonFriend)=${skippedFriendList}, skippedQueue=${skippedQueue}, skippedPendingList=${skippedPendingList}`
            );

            if (queueDocs.length) {
                const inserted = await insertManyBatched(
                    friendsQueueCollection,
                    queueDocs,
                    `friends_queue user_id=${userId}`
                );
                const activityInserted = await insertManyBatched(
                    activityCollection,
                    activityDocs,
                    `activity queue user_id=${userId}`
                );
                console.log(
                    `Finished friends_queue for user_id: ${userId}. Inserted ${inserted} queue records and ${activityInserted} activity records.`
                );
            } else {
                console.log(`No new friends_queue records for user_id: ${userId}`);
            }
        }
    } catch (error) {
        console.error('Error:', error);
    } finally {
        await client.close();
    }
}

seedBuddyHostsIntoFriendsQueue().catch(console.error);
