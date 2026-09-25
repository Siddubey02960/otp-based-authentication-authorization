/**
 * Seed mutual buddies + "Non friend" friend_lists for target users.
 *
 * WHAT THIS SCRIPT DOES
 * ---------------------
 * For each TARGET_USER_IDS profile (default 1909, 1914) and every visible
 * friender_user_list contact:
 *
 * 1. Buddies (both directions)
 *    - Inserts a buddies row for target → contact and contact → target
 *      (buddy_status: 2) if that buddy link does not already exist.
 *
 * 2. friend_lists "Non friend" (both directions)
 *    - Checks friend_lists for owner → other (any friendStatus).
 *    - If already present → skip that direction.
 *    - If missing → insert a "Non friend" row (same shape as production
 *      buddy-accept Non friend create), with optional GENDER_API gender/country.
 *    - On create, $addToSet the new friend_lists _id into that owner's
 *      default "Unlabeled" label contact_ids.
 *
 * 3. Activity (for each newly created Non friend row)
 *    - friendStatusChanged (type 17): "" → "Non friend"
 *    - gender (type 11): added with friendGender
 *    - country (type 12): added with { country, tier } when country is non-blank
 *    - Each activity includes location: "buddy"
 *
 * HOW TO RUN (standalone / elsewhere) 
 * -----------------------------------
 * 1. Set `uri` to the target Mongo cluster.
 * 2. Optionally set `GENDER_API` (leave empty to skip enrichment).
 * 3. Optionally change TARGET_USER_IDS / BATCH_SIZE.
 * 4. From a machine with network access to Mongo (and GENDER_API if set):
 *
 *      node src/script.js
 *
 * Requires: mongodb (and node 18+ for fetch, used only when GENDER_API is set).
 * Does not depend on serverless env, fr-mongodb, or other app modules.
 */

const { MongoClient } = require('mongodb');

//const uri = 'mongodb+srv://FR_SECRET_DEV:KxZLWdg5dwOfGB1i@cluster0.u2quf8g.mongodb.net/';
const uri = 'mongodb+srv://FR_SECRET_READ_BETA:wjbQ3Pr1ZUPeDZ46@fr-frlst-beta.qricz.mongodb.net/'

const TARGET_USER_IDS = [1914];
const BATCH_SIZE = 500;

/** Set to gender API URL to enrich Non friend rows; leave empty to use UNKNOWN / blank country. */
const GENDER_API = 'https://9c0uuhq9sh.execute-api.us-east-1.amazonaws.com/beta/fetch-gender-by-name';

const NON_FRIEND_STATUS = 'Non friend';
const ACTIVITY_TYPE = {
    gender: 11,
    country: 12,
    friendStatusChanged: 17,
};
const ACTION = {
    added: 1,
    updated: 3,
};

function nowTimestamp() {
    return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

async function enrichFromGenderApi(friendName) {
    let friendGender = 'UNKNOWN';
    let country = ' ';
    let tier = null;

    if (!friendName || !GENDER_API) {
        return { friendGender, country, tier };
    }

    try {
        const response = await fetch(GENDER_API, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: friendName }),
        });
        const data = await response.json();
        const body = data?.data?.body || data?.body || {};

        const genderRaw = body?.gender != null ? String(body.gender).toUpperCase() : null;
        friendGender = !genderRaw || genderRaw === 'NA' ? 'UNKNOWN' : genderRaw;

        const countryRaw = body?.countryName != null ? String(body.countryName) : null;
        country = !countryRaw || countryRaw.toUpperCase() === 'NA' ? ' ' : countryRaw;

        const tierRaw = body?.Tiers != null ? String(body.Tiers) : null;
        tier = !tierRaw || tierRaw.toUpperCase() === 'NA' ? null : tierRaw;
    } catch (err) {
        console.error('GENDER_API error:', err?.message || err);
    }

    return { friendGender, country, tier };
}

async function ensureUserProfileSync(syncCollection, { user_id, fb_user_id, now }) {
    let sync = await syncCollection.findOne({
        user_id: Number(user_id),
        fb_user_id: String(fb_user_id),
    });

    if (sync) {
        return sync;
    }

    const result = await syncCollection.insertOne({
        user_id: Number(user_id),
        fb_user_id: String(fb_user_id),
        sync_date: now,
        last_sync_at: now,
        created_at: now,
        updated_at: now,
    });

    return {
        _id: result.insertedId,
        user_id: Number(user_id),
        fb_user_id: String(fb_user_id),
        syncing_id: null,
    };
}

async function getUnlabeledLabelId(labelsCollection, { user_id, fb_user_id }) {
    const label = await labelsCollection.findOne({
        user_id: Number(user_id),
        fb_user_id: String(fb_user_id),
        title: 'Unlabeled',
    });
    return label?._id ?? null;
}

const ACTIVITY_LOCATION = 'buddy';

function buildActivityDocs({
    ownerUserId,
    ownerFbUserId,
    friendFbId,
    friendListId,
    friendGender,
    country,
    tier,
    now,
}) {
    const docs = [
        {
            user_id: Number(ownerUserId),
            fb_user_id: String(ownerFbUserId),
            created_at: now,
            activity_type: ACTIVITY_TYPE.friendStatusChanged,
            action: ACTION.updated,
            location: ACTIVITY_LOCATION,
            activity_info: {
                oldValue: '',
                newValue: NON_FRIEND_STATUS,
                location: ACTIVITY_LOCATION,
            },
            friend_id: String(friendListId),
            friendFbId: String(friendFbId),
        },
    ];

    if (friendGender) {
        docs.push({
            user_id: Number(ownerUserId),
            fb_user_id: String(ownerFbUserId),
            created_at: now,
            activity_type: ACTIVITY_TYPE.gender,
            action: ACTION.added,
            location: ACTIVITY_LOCATION,
            activity_info: {
                oldValue: '',
                newValue: friendGender,
                location: ACTIVITY_LOCATION,
            },
            friendFbId: String(friendFbId),
        });
    }

    if (country && String(country).trim()) {
        docs.push({
            user_id: Number(ownerUserId),
            fb_user_id: String(ownerFbUserId),
            created_at: now,
            activity_type: ACTIVITY_TYPE.country,
            action: ACTION.added,
            location: ACTIVITY_LOCATION,
            activity_info: {
                oldValue: '',
                newValue: { country, tier },
                location: ACTIVITY_LOCATION,
            },
            friendFbId: String(friendFbId),
        });
    }

    return docs;
}

/**
 * Insert Non friend into friend_lists for owner → friend if not already present.
 * Returns { created, skipped, activityDocs }.
 */
async function ensureNonFriendListEntry({
    friendListsCollection,
    syncCollection,
    labelsCollection,
    ownerUserId,
    ownerFbUserId,
    friendFbId,
    friendName,
    friendProfilePicture,
    friendProfileUrl,
    now,
    genderCache,
}) {
    if (!ownerUserId || !ownerFbUserId || !friendFbId) {
        return { created: false, skipped: true, activityDocs: [] };
    }

    const existing = await friendListsCollection.findOne({
        user_id: Number(ownerUserId),
        fb_user_id: String(ownerFbUserId),
        friendFbId: String(friendFbId),
    });

    if (existing) {
        return { created: false, skipped: true, activityDocs: [] };
    }

    const sync = await ensureUserProfileSync(syncCollection, {
        user_id: ownerUserId,
        fb_user_id: ownerFbUserId,
        now,
    });
    const labelId = await getUnlabeledLabelId(labelsCollection, {
        user_id: ownerUserId,
        fb_user_id: ownerFbUserId,
    });

    const cacheKey = friendName || '';
    if (!genderCache.has(cacheKey)) {
        genderCache.set(cacheKey, await enrichFromGenderApi(friendName));
    }
    const { friendGender, country, tier } = genderCache.get(cacheKey);

    const payload = {
        user_id: Number(ownerUserId),
        friendFbId: String(friendFbId),
        fb_user_id: String(ownerFbUserId),
        created_at: now,
        finalSource: 'buddy',
        friendGender,
        label: labelId,
        tags: [],
        friendMessageUrl: `https://www.facebook.com/messages/t/${friendFbId}`,
        friendName: friendName || null,
        friendProfilePicture: friendProfilePicture || null,
        friendProfileUrl: friendProfileUrl || null,
        friendShortName: null,
        friendStatus: NON_FRIEND_STATUS,
        friend_list_id: sync?._id ?? null,
        mutualFriend: '',
        source: 'buddy',
        syncing_id: sync?.syncing_id ?? null,
        updated_at: now,
        gender: null,
        last_friend_request_send_at: null,
        matchedKeyword: null,
        refriending: false,
        refriending_max_attempts: null,
        refriending_pending_days: null,
        sourceName: 'buddy',
        country,
        tier,
        message_thread: null,
        post_id: '',
        whitelist_status: 0,
        blacklist_status: 0,
        post_engagement_status: null,
        comments: [],
        reactions: [],
        sourceUrl: null,
    };

    const result = await friendListsCollection.insertOne(payload);
    const insertedId = result.insertedId;

    // Attach Non friend _id to the owner's default Unlabeled label
    if (labelId && insertedId) {
        await labelsCollection.updateOne(
            { _id: labelId },
            { $addToSet: { contact_ids: insertedId } }
        );
    }

    const activityDocs = buildActivityDocs({
        ownerUserId,
        ownerFbUserId,
        friendFbId,
        friendListId: insertedId,
        friendGender,
        country,
        tier,
        now,
    });

    return { created: true, skipped: false, activityDocs };
}

async function insertManyBatched(collection, docs, label) {
    let inserted = 0;
    for (let i = 0; i < docs.length; i += BATCH_SIZE) {
        const batch = docs.slice(i, i + BATCH_SIZE);
        try {
            const result = await collection.insertMany(batch, { ordered: false });
            inserted += result.insertedCount || batch.length;
        } catch (err) {
            // ordered:false can still throw after partial insert
            inserted += err?.result?.nInserted || err?.insertedCount || 0;
            console.error(`${label} batch error:`, err?.message || err);
        }
        console.log(
            `${label}: batch ${Math.floor(i / BATCH_SIZE) + 1} (${batch.length} docs)`
        );
    }
    return inserted;
}

async function seedBuddiesFromFrienderUserList() {
    const client = new MongoClient(uri, {
        useNewUrlParser: true,
        useUnifiedTopology: true,
    });

    try {
        await client.connect();

        const database = client.db('fr_profile');
        const profileCollections = database.collection('profiles');
        const frienderUserListCollections = database.collection('friender_user_list');
        const buddiesCollections = database.collection('buddies');
        const friendListsCollection = database.collection('friend_lists');
        const activityCollection = database.collection('activity');
        const syncCollection = database.collection('user_profile_sync');
        const labelsCollection = database.collection('labels');
        const now = nowTimestamp();
        const genderCache = new Map();

        const frienderUsers = await frienderUserListCollections
            .aggregate([
                {
                    $match: {
                        // is_visible: false,
                        // user_id: { $nin: [1909, 1914] },
                        fb_user_id: { $ne: null },
                        user_name: { $ne: null },
                        profileUrl: { $ne: null },
                    },
                },
                {
                    $project: { 
                        user_id: 1,
                        fb_user_id: 1,
                        profilePicture: 1,
                        profileUrl: 1,
                        user_name: 1,
                    },
                },
            ])
            .toArray();

        console.log(`Fetched ${frienderUsers.length} friender_user_list records`);

        if (!frienderUsers.length) {
            console.log('No friender_user_list records found. Exiting.');
            return;
        }
 
        const profiles = await profileCollections
            .aggregate([
                {
                    $match: {
                        user_id: { $in: TARGET_USER_IDS },
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
                {
                    $sort: { user_id: 1 },
                },
            ])
            .toArray();

        console.log(`Found ${profiles.length} profiles for target users`);

        for (const profile of profiles) {
            const userId = Number(profile.user_id);
            const fbUserId = String(profile.fb_user_id);

            console.log(`Processing user_id: ${userId}, fb_user_id: ${fbUserId}`);

            const existingBuddies = await buddiesCollections
                .find({
                    user_id: userId,
                    fb_user_id: fbUserId,
                    deleted_at: { $in: [null, ''] },
                })
                .project({ friendFbId: 1 })
                .toArray();

            const existingBuddyMap = {};
            for (const buddy of existingBuddies) {
                existingBuddyMap[String(buddy.friendFbId)] = true;
            }

            const buddyDocs = [];
            const seen = {};
            const pairsForNonFriend = [];
            let nonFriendCreated = 0;
            let nonFriendSkipped = 0;
            const activityDocs = [];

            for (const contact of frienderUsers) {
                const friendFbId = contact?.fb_user_id ? String(contact.fb_user_id) : null;

                if (!friendFbId) continue;
                if (Number(contact.user_id) === userId) continue;
                if (friendFbId === fbUserId) continue;
                if (seen[friendFbId]) continue;

                seen[friendFbId] = true;

                // Mutual buddies (skip if target already has this buddy)
                if (!existingBuddyMap[friendFbId]) {
                    buddyDocs.push({
                        user_id: userId,
                        fb_user_id: fbUserId,
                        friendFbId,
                        fb_profile_picture: contact.profilePicture ?? null,
                        fb_profile_url: contact.profileUrl ?? null,
                        name: contact.user_name ?? null,
                        buddy_status: 2,
                        interactions: null,
                        created_at: now,
                        updated_at: now,
                    });
                    buddyDocs.push({
                        user_id: contact.user_id,
                        fb_user_id: contact.fb_user_id,
                        friendFbId: fbUserId,
                        fb_profile_picture: profile.profilePicture ?? null,
                        fb_profile_url: profile.profileUrl ?? null,
                        name: profile.name ?? null,
                        buddy_status: 2,
                        interactions: null,
                        created_at: now,
                        updated_at: now,
                    });
                }

                pairsForNonFriend.push({
                    contactUserId: contact.user_id,
                    contactFbUserId: contact.fb_user_id,
                    friendFbId,
                    contactName: contact.user_name ?? null,
                    contactPicture: contact.profilePicture ?? null,
                    contactUrl: contact.profileUrl ?? null,
                });
            }

            if (buddyDocs.length) {
                const inserted = await insertManyBatched(
                    buddiesCollections,
                    buddyDocs,
                    `buddies user_id=${userId}`
                );
                console.log(`Finished buddies for user_id: ${userId}. Inserted ${inserted}.`);
            } else {
                console.log(`No new buddies to insert for user_id: ${userId}`);
            }

            // Mutual Non friend friend_lists + activities
            for (const pair of pairsForNonFriend) {
                // Target owns list → contact as Non friend
                const aToB = await ensureNonFriendListEntry({
                    friendListsCollection,
                    syncCollection,
                    labelsCollection,
                    ownerUserId: userId,
                    ownerFbUserId: fbUserId,
                    friendFbId: pair.friendFbId,
                    friendName: pair.contactName,
                    friendProfilePicture: pair.contactPicture,
                    friendProfileUrl: pair.contactUrl,
                    now,
                    genderCache,
                });
                if (aToB.created) {
                    nonFriendCreated += 1;
                    activityDocs.push(...aToB.activityDocs);
                } else {
                    nonFriendSkipped += 1;
                }

                // Contact owns list → target as Non friend
                const bToA = await ensureNonFriendListEntry({
                    friendListsCollection,
                    syncCollection,
                    labelsCollection,
                    ownerUserId: pair.contactUserId,
                    ownerFbUserId: pair.contactFbUserId,
                    friendFbId: fbUserId,
                    friendName: profile.name ?? null,
                    friendProfilePicture: profile.profilePicture ?? null,
                    friendProfileUrl: profile.profileUrl ?? null,
                    now,
                    genderCache,
                });
                if (bToA.created) {
                    nonFriendCreated += 1;
                    activityDocs.push(...bToA.activityDocs);
                } else {
                    nonFriendSkipped += 1;
                }
            }

            console.log(
                `Non friend for user_id ${userId}: created=${nonFriendCreated}, skipped(already present)=${nonFriendSkipped}`
            );

            if (activityDocs.length) {
                const activityInserted = await insertManyBatched(
                    activityCollection,
                    activityDocs,
                    `activity user_id=${userId}`
                );
                console.log(
                    `Finished activities for user_id: ${userId}. Inserted ${activityInserted}.`
                );
            } else {
                console.log(`No new activities for user_id: ${userId}`);
            }
        }
    } catch (error) {
        console.error('Error:', error);
    } finally {
        await client.close();
    }
}

seedBuddiesFromFrienderUserList().catch(console.error);
