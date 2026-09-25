/**
 * addFriendsSectionTracker script
 *
 * Base condition:
 * {
 *   friendStatus: "Activate",
 *   deleted_status: { $in: [null, ""] }
 * }
 *
 * Flow (same branching style as Lost/Unfriend):
 * - If `last_non_friend_at` exists (non-null/non-empty):
 *   1) Insert "Non friend" at created_at = last_non_friend_at (+ country, gender, tier)
 *   2) Insert transition "Non friend" -> "Friend" at created_at = friend_lists.created_at
 * - Else:
 *   1) Insert "Friend" at created_at = friend_lists.created_at (+ country, gender, tier)
 *
 * Output collection: `fr_profile.activity`
 * All inserted documents have `script: true`.
 */
const { MongoClient } = require('mongodb');
require('dotenv').config();

const uri = 'mongodb+srv://FR_SECRET_READ_BETA:wjbQ3Pr1ZUPeDZ46@fr-frlst-beta.qricz.mongodb.net/';

const dbName = process.env.DATABASE_NAME || 'fr_profile';

const ACTIVITY_TYPE_FRIEND_STATUS_CHANGED = 17;
const ACTIVITY_TYPE_BIRTHDAY = 5;
const ACTIVITY_TYPE_GENDER = 11;
const ACTIVITY_TYPE_COUNTRY = 12;

const ACTION_ADDED = 1;
const ACTION_UPDATED = 3;

const BATCH_SIZE = 1000;

function nowSql() {
    return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

function isNonEmpty(val) {
    return val != null && String(val).trim() !== '';
}

function isValidGender(val) {
    if (!isNonEmpty(val)) return false;
    return !['', 'NA', 'UNKNOWN'].includes(String(val).trim().toUpperCase());
}

function hasCountryOrTier(country, tier) {
    const valid = (v) =>
        isNonEmpty(v) && !['NA'].includes(String(v).trim().toUpperCase());
    return valid(country) || valid(tier);
}

function hasAnyDobField(dob) {
    return (
        isNonEmpty(dob?.day) ||
        isNonEmpty(dob?.month) ||
        isNonEmpty(dob?.year)
    );
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
        const friendListsCollection = database.collection('friend_lists');
        const activityCollection = database.collection('activity');

        const profileQuery = {
            user_id: { $ne: 1909 },
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

            const cursor = friendListsCollection.find({
                user_id,
                fb_user_id,
                friendStatus: 'Activate',
                deleted_status: { $in: [null, '', 0] },
                //friendFbId: { $exists: true, $nin: [null, ''] },
                // Only consider contacts where these fields are not present.
                lost_at: { $exists: false },
                last_friend_at: { $exists: false },
                // last_non_friend_at: { $exists: false },
                deleted_at: { $in: [null, ""]}
            });

            let batch = [];
            let profileInserted = 0;

            while (await cursor.hasNext()) {
                const doc = await cursor.next();
                const friendFbId = doc.friendFbId?.toString?.() ?? null;
                if (!friendFbId) continue;

                const friendAt = doc.created_at || nowSql();
                const nonFriendAt = doc.last_non_friend_at;
                const nonFriendInsertAt = isNonEmpty(nonFriendAt) ? nonFriendAt : null;

                const gender = doc.gender || doc.friendGender;
                const country = doc.country;
                const tier = doc.tier;

                if (isNonEmpty(nonFriendAt)) {
                    // 1) Non friend at last_non_friend_at
                    batch.push({
                        user_id,
                        fb_user_id,
                        created_at: nonFriendInsertAt,
                        activity_type: ACTIVITY_TYPE_FRIEND_STATUS_CHANGED,
                        action: ACTION_ADDED,
                        script14: true ,
                        friendFbId,
                        activity_info: { oldValue: null, newValue: 'Non friend' },
                    });

                    // Non friend: DOB + country/gender/tier
                    if (hasAnyDobField(doc.date_of_birth)) {
                        batch.push({
                            user_id,
                            fb_user_id,
                            created_at: nonFriendInsertAt,
                            activity_type: ACTIVITY_TYPE_BIRTHDAY,
                            action: ACTION_ADDED,
                           script14: true ,
                            friendFbId,
                            activity_info: { oldValue: null, newValue: doc.date_of_birth },
                        });
                    }

                    if (isValidGender(gender)) {
                        batch.push({
                            user_id,
                            fb_user_id,
                            created_at: nonFriendInsertAt,
                            activity_type: ACTIVITY_TYPE_GENDER,
                            action: ACTION_ADDED,
                           script14: true ,
                            friendFbId,
                            activity_info: { oldValue: null, newValue: gender },
                        });
                    }

                    if (hasCountryOrTier(country, tier)) {
                        batch.push({
                            user_id,
                            fb_user_id,
                            created_at: nonFriendInsertAt,
                            activity_type: ACTIVITY_TYPE_COUNTRY,
                            action: ACTION_ADDED,
                           script14: true ,
                            friendFbId,
                            activity_info: {
                                oldValue: null,
                                newValue: { country: country || null, tier: tier || null },
                            },
                        });
                    }

                    // 2) Non friend -> Friend at created_at
                    batch.push({
                        user_id,
                        fb_user_id,
                        created_at: friendAt,
                        activity_type: ACTIVITY_TYPE_FRIEND_STATUS_CHANGED,
                        action: ACTION_UPDATED,
                       script14: true ,
                        friendFbId,
                        activity_info: { oldValue: 'Non friend', newValue: 'Friend' },
                    });
                } else {
                    // Friend directly at created_at
                    batch.push({
                        user_id,
                        fb_user_id,
                        created_at: friendAt,
                        activity_type: ACTIVITY_TYPE_FRIEND_STATUS_CHANGED,
                        action: ACTION_ADDED,
                       script14: true ,
                        friendFbId,
                        activity_info: { oldValue: null, newValue: 'Friend' },
                    });

                    // Friend: DOB + country/gender/tier
                    if (hasAnyDobField(doc.date_of_birth)) {
                        batch.push({
                            user_id,
                            fb_user_id,
                            created_at: friendAt,
                            activity_type: ACTIVITY_TYPE_BIRTHDAY,
                            action: ACTION_ADDED,
                           script14: true ,
                            friendFbId,
                            activity_info: { oldValue: null, newValue: doc.date_of_birth },
                        });
                    }

                    if (isValidGender(gender)) {
                        batch.push({
                            user_id,
                            fb_user_id,
                            created_at: friendAt,
                            activity_type: ACTIVITY_TYPE_GENDER,
                            action: ACTION_ADDED,
                            script14: true,
                            friendFbId,
                            activity_info: { oldValue: null, newValue: gender },
                        });
                    }

                    if (hasCountryOrTier(country, tier)) {
                        batch.push({
                            user_id,
                            fb_user_id,
                            created_at: friendAt,
                            activity_type: ACTIVITY_TYPE_COUNTRY,
                            action: ACTION_ADDED,
                            script14: true ,
                            friendFbId,
                            activity_info: {
                                oldValue: null,
                                newValue: { country: country || null, tier: tier || null },
                            },
                        });
                    }
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
                    `Profile user_id=${user_id}: inserted ${profileInserted} friends-section activity records.`
                );
            }
        }

        console.log(
            `Done. Total friends-section activity records inserted: ${totalInserted}.`
        );
    } catch (error) {
        console.error('Error:', error);
        throw error;
    } finally {
        await client.close();
    }
}

run().catch(console.error);

