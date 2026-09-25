/**
 * addPostEngagementNonFriendThenFriendTracker script
 *
 * Condition:
 * - source: "post_engagement"
 * - friendStatus: "Activte"
 * - deleted_status: 0
 *
 * Backfill:
 * 1) Add "Non friend" first at created_at = last_non_friend_at
 *    - friendStatusChanged (17) + DOB (5) + Gender (11) + Country (12)
 *    - Only these fields are tracked for the non-friend event
 * 2) Add "Non friend" -> "Friend" at created_at = friend_lists.created_at
 *
 * Output collection: `fr_profile.activity`
 */
const { MongoClient } = require('mongodb');
require('dotenv').config();

const uri =
    process.env.DATABASE_READ_HOST ||
    'mongodb+srv://FR_SECRET_DEV:KxZLWdg5dwOfGB1i@cluster0.u2quf8g.mongodb.net/';

const dbName = process.env.DATABASE_NAME || 'fr_profile';

const ACTIVITY_TYPE_FRIEND_STATUS_CHANGED = 17;
const ACTIVITY_TYPE_BIRTHDAY = 5;
const ACTIVITY_TYPE_GENDER = 11;
const ACTIVITY_TYPE_COUNTRY = 12;

const ACTION_ADDED = 1;
const ACTION_UPDATED = 3;

const BATCH_SIZE = 1000;

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
            user_id: 1909,
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
                source: 'post_engagement',
                friendStatus: 'Activate',
                deleted_status: 0,
                last_non_friend_at: { $exists: true, $nin: [null, ''] },
                friendFbId: { $exists: true, $nin: [null, ''] },
            });

            let batch = [];
            let profileInserted = 0;

            while (await cursor.hasNext()) {
                const doc = await cursor.next();
                const friendFbId = doc.friendFbId?.toString?.() ?? null;
                if (!friendFbId) continue;

                const nonFriendAt = doc.last_non_friend_at;
                const friendAt =
                    doc.created_at ||
                    new Date().toISOString().slice(0, 19).replace('T', ' ');

                // 1) Add Non friend first at last_non_friend_at
                batch.push({
                    user_id,
                    fb_user_id,
                    created_at: nonFriendAt,
                    activity_type: ACTIVITY_TYPE_FRIEND_STATUS_CHANGED,
                    action: ACTION_ADDED,
                    script: true,
                    friendFbId,
                    activity_info: { oldValue: null, newValue: 'Non friend' },
                });

                // Only add DOB, gender, country for non-friend event
                if (hasAnyDobField(doc.date_of_birth)) {
                    batch.push({
                        user_id,
                        fb_user_id,
                        created_at: nonFriendAt,
                        activity_type: ACTIVITY_TYPE_BIRTHDAY,
                        action: ACTION_ADDED,
                        script: true,
                        friendFbId,
                        activity_info: { oldValue: null, newValue: doc.date_of_birth },
                    });
                }

                const gender = doc.gender || doc.friendGender;
                if (isValidGender(gender)) {
                    batch.push({
                        user_id,
                        fb_user_id,
                        created_at: nonFriendAt,
                        activity_type: ACTIVITY_TYPE_GENDER,
                        action: ACTION_ADDED,
                        script: true,
                        friendFbId,
                        activity_info: { oldValue: null, newValue: gender },
                    });
                }

                const country = doc.country;
                const tier = doc.tier;
                if (hasCountryOrTier(country, tier)) {
                    batch.push({
                        user_id,
                        fb_user_id,
                        created_at: nonFriendAt,
                        activity_type: ACTIVITY_TYPE_COUNTRY,
                        action: ACTION_ADDED,
                        script: true,
                        friendFbId,
                        activity_info: {
                            oldValue: null,
                            newValue: { country: country || null, tier: tier || null },
                        },
                    });
                }

                // 2) Non friend -> Friend at doc.created_at
                batch.push({
                    user_id,
                    fb_user_id,
                    created_at: friendAt,
                    activity_type: ACTIVITY_TYPE_FRIEND_STATUS_CHANGED,
                    action: ACTION_UPDATED,
                    script: true,
                    friendFbId,
                    activity_info: { oldValue: 'Non friend', newValue: 'Friend' },
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
                    `Profile user_id=${user_id}: inserted ${profileInserted} post_engagement non-friend + non-friend->friend activity records.`
                );
            }
        }

        console.log(
            `Done. Total post_engagement non-friend + non-friend->friend activity records inserted: ${totalInserted}.`
        );
    } catch (error) {
        console.error('Error:', error);
        throw error;
    } finally {
        await client.close();
    }
}

run().catch(console.error);

