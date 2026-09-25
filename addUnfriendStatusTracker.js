/**
 * addUnfriendStatusTracker script
 *
 * Base condition:
 * - friendStatus: "Activate"
 * - deleted_status: 1
 *
 * Backfill:
 * - If last_non_friend_at exists (Non friend -> Friend -> Unfriend):
 *   1) Add "Non friend" first at created_at = friend_lists.last_non_friend_at
 *      - friendStatusChanged (17) + DOB (5) + Gender (11) + Country (12)
 *   2) Add transition "Non friend" -> "Friend" at created_at = friend_lists.last_friend_at (fallback: created_at)
 *   3) Add "Unfriend" at created_at = (lost_at || deleted_at || updated_at || now)
 *      - activity_type = Unfriend (3)
 *
 * - Else (Friend -> Unfriend):
 *   1) Add "Friend" first at created_at = friend_lists.last_friend_at (fallback: created_at)
 *      - friendStatusChanged (17) + DOB (5) + Gender (11) + Country (12)
 *   2) Add "Unfriend" at created_at = (lost_at || deleted_at || updated_at || now)
 *
 * Output collection: `fr_profile.activity`
 */
const { MongoClient } = require('mongodb');
require('dotenv').config();

// Prefer the connection string from `.env` (your repo uses `MONGO_URI`).
// Fall back to `DATABASE_READ_HOST` only if you still set that in your environment.
const uri = 'mongodb+srv://FR_SECRET_READ_BETA:wjbQ3Pr1ZUPeDZ46@fr-frlst-beta.qricz.mongodb.net/';
if (!uri) {
    throw new Error(
        "Missing MongoDB connection string. Please set `MONGO_URI` in .env (or `DATABASE_READ_HOST`)."
    );
}

const dbName = process.env.DATABASE_NAME || 'fr_profile';

const ACTIVITY_TYPE_UNFRIEND = 3;
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

function pickUnfriendAt(doc) {
    return doc.lost_at || doc.deleted_at || doc.updated_at || nowSql();
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
            user_id:{ $ne: null },
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
                deleted_status: 1,
                // NOTE: don't declare `friendFbId` twice; the last key overrides the first.
                // If you want to target a single friend, keep ONLY the equality filter.
                // friendFbId: "1427974903",
            });

            let batch = [];
            let profileInserted = 0;

            while (await cursor.hasNext()) {
                const doc = await cursor.next();
                const friendFbId = doc.friendFbId?.toString?.() ?? null;
                if (!friendFbId) continue;

                const nonFriendAt = doc?.last_non_friend_at;
                const friendAt = doc?.last_friend_at || doc?.created_at;
                if (!friendAt) continue;

                const unfriendAt = doc?.deleted_at;

                const gender = doc.gender || doc.friendGender;
                const country = doc.country;
                const tier = doc.tier;

                //console.log("lastnonfrndat", JSON.stringify(doc) );

                if (isNonEmpty(nonFriendAt)) {
                    // 1) Non friend at last_non_friend_at (+ fields)
                    batch.push({
                        user_id,
                        fb_user_id,
                        created_at: nonFriendAt,
                        activity_type: ACTIVITY_TYPE_FRIEND_STATUS_CHANGED,
                        action: ACTION_ADDED,
                        script6: true ,
                        friendFbId,
                        activity_info: { oldValue: null, newValue: 'Non friend' },
                    });

                    if (hasAnyDobField(doc.date_of_birth)) {
                        batch.push({
                            user_id,
                            fb_user_id,
                            created_at: nonFriendAt,
                            activity_type: ACTIVITY_TYPE_BIRTHDAY,
                            action: ACTION_ADDED,
                            script6: true ,
                            friendFbId,
                            activity_info: {
                                oldValue: null,
                                newValue: doc.date_of_birth,
                            },
                        });
                    }

                    if (isValidGender(gender)) {
                        batch.push({
                            user_id,
                            fb_user_id,
                            created_at: nonFriendAt,
                            activity_type: ACTIVITY_TYPE_GENDER,
                            action: ACTION_ADDED,
                            script6: true ,
                            friendFbId,
                            activity_info: { oldValue: null, newValue: gender },
                        });
                    }

                    if (hasCountryOrTier(country, tier)) {
                        batch.push({
                            user_id,
                            fb_user_id,
                            created_at: nonFriendAt,
                            activity_type: ACTIVITY_TYPE_COUNTRY,
                            action: ACTION_ADDED,
                            script6: true ,
                            friendFbId,
                            activity_info: {
                                oldValue: null,
                                newValue: {
                                    country: country || null,
                                    tier: tier || null,
                                },
                            },
                        });
                    }

                    // 2) Non friend -> Friend
                    batch.push({
                        user_id,
                        fb_user_id,
                        created_at: friendAt,
                        activity_type: ACTIVITY_TYPE_FRIEND_STATUS_CHANGED,
                        action: ACTION_UPDATED,
                        script6: true ,
                        friendFbId,
                        activity_info: { oldValue: 'Non friend', newValue: 'Friend' },
                    });
                } else {
                    // Start with Friend (+ fields)
                    batch.push({
                        user_id,
                        fb_user_id,
                        created_at: friendAt,
                        activity_type: ACTIVITY_TYPE_FRIEND_STATUS_CHANGED,
                        action: ACTION_ADDED,
                        script6: true ,
                        friendFbId,
                        activity_info: { oldValue: null, newValue: 'Friend' },
                    });

                    if (hasAnyDobField(doc.date_of_birth)) {
                        batch.push({
                            user_id,
                            fb_user_id,
                            created_at: friendAt,
                            activity_type: ACTIVITY_TYPE_BIRTHDAY,
                            action: ACTION_ADDED,
                            script6: true ,
                            friendFbId,
                            activity_info: {
                                oldValue: null,
                                newValue: doc.date_of_birth,
                            },
                        });
                    }

                    if (isValidGender(gender)) {
                        batch.push({
                            user_id,
                            fb_user_id,
                            created_at: friendAt,
                            activity_type: ACTIVITY_TYPE_GENDER,
                            action: ACTION_ADDED,
                            script6: true ,
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
                            script6: true ,
                            friendFbId,
                            activity_info: {
                                oldValue: null,
                                newValue: {
                                    country: country || null,
                                    tier: tier || null,
                                },
                            },
                        });
                    }
                }

                // Final) Friend -> Unfriend
                batch.push({
                    user_id,
                    fb_user_id,
                    created_at: unfriendAt,
                    activity_type: ACTIVITY_TYPE_FRIEND_STATUS_CHANGED,
                    action: ACTION_ADDED,
                    script6: true ,
                    friendFbId,
                    activity_info: { oldValue: 'Friend', newValue: 'Unfriend' },
                });

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
                    `Profile user_id=${user_id}: inserted ${profileInserted} unfriend activity records.`
                );
            }
        }

        console.log(
            `Done. Total unfriend activity records inserted: ${totalInserted}.`
        );
    } catch (error) {
        console.error('Error:', error);
        throw error;
    } finally {
        await client.close();
    }
}

run().catch(console.error);

