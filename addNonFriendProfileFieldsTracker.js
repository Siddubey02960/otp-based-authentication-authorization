/**
 * addNonFriendProfileFieldsTracker script
 *
 * Finds friend_lists records with friendStatus "Non friend" and inserts activity
 * entries for:
 * - birthday (activity_type 5)
 * - gender   (activity_type 11)
 * - country  (activity_type 12)  -> { country, tier }
 *
 * created_at is taken from the friend_lists document created_at.
 */

const { MongoClient } = require('mongodb');
require('dotenv').config();

// Connection URI
//const uri = 'mongodb+srv://FR_SECRET_DEV:KxZLWdg5dwOfGB1i@cluster0.u2quf8g.mongodb.net/';
const uri = 'mongodb+srv://FR_SECRET_READ_BETA:wjbQ3Pr1ZUPeDZ46@fr-frlst-beta.qricz.mongodb.net/';

// Database details
const dbName = 'fr_profile';

// Activity types and actions
const ACTIVITY_TYPE_FRIEND_STATUS_CHANGED = 17;
const ACTIVITY_TYPE_BIRTHDAY = 5;
const ACTIVITY_TYPE_GENDER = 11;
const ACTIVITY_TYPE_COUNTRY = 12;

const ACTION_ADDED = 1;
const ACTION_UPDATED = 3;

function isNonEmpty(val) {
    return val != null && String(val).trim() !== '';
}

function isValidGender(val) {
    if (!isNonEmpty(val)) return false;
    return !['', 'NA', 'UNKNOWN'].includes(String(val).trim().toUpperCase());
}

function hasCountryOrTier(country, tier) {
    const valid = (v) => isNonEmpty(v) && !['NA'].includes(String(v).trim().toUpperCase());
    return valid(country) || valid(tier);
}

function toSqlDateTime(value) {
    if (!value) return null;
    const dt = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(dt.getTime())) return null;
    return dt.toISOString().slice(0, 19).replace('T', ' ');
}

function plusOneSecondSql(value) {
    const dt = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(dt.getTime())) return null;
    dt.setSeconds(dt.getSeconds() + 600);
    return dt.toISOString().slice(0, 19).replace('T', ' ');
}

async function resolveNonFriendPlacementAt(
    activityCollection,
    { user_id, fb_user_id, friendFbId, friendDocId, fallbackAt }
) {
    const friendDocIdStr = friendDocId?.toString?.();
    const friendMatch = [{ friendFbId }];
    // if (friendDocId != null) {
    //     friendMatch.push({ friend_id: friendDocId });
    // }
    if (friendDocIdStr) {
        friendMatch.push({ friend_id: friendDocIdStr });
    }

    const lastActivity = await activityCollection.findOne(
        {
            user_id,
            fb_user_id,
            $or: friendMatch,
            created_at: { $exists: true, $nin: [null, ''] },
        },
        { sort: { created_at: 1 }, projection: { created_at: 1 } }
    );

    const lastCreatedAt = toSqlDateTime(lastActivity?.created_at);
    if (!lastCreatedAt) return fallbackAt;
    return plusOneSecondSql(lastCreatedAt) || fallbackAt;
}

async function runNonFriendFieldsTracker() {
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
                user_id: {$ne: 1909},
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

            const nonFriendRecords = await friendListsCollection
                .find({
                    user_id,
                    fb_user_id,
                    friendStatus: 'Non friend'
                })
                .toArray();

            if (nonFriendRecords.length === 0) continue;

            const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
            const activityRecords = [];

            for (const doc of nonFriendRecords) {
                const friendFbId = doc.friendFbId ? doc.friendFbId.toString() : null;
                if (!friendFbId) continue;
                const createdAt = doc.created_at;

                // Friend status changed -> Non friend
                activityRecords.push({
                    user_id,
                    fb_user_id,
                    created_at: createdAt,
                    activity_type: ACTIVITY_TYPE_FRIEND_STATUS_CHANGED,
                    action: ACTION_ADDED,
                    friendFbId,
                    script10: true,
                    activity_info: { oldValue: null, newValue: 'Non friend' }
                });

                // Birthday tracker (date_of_birth)
                if (
                    isNonEmpty(doc.date_of_birth?.day) &&
                    isNonEmpty(doc.date_of_birth?.month) &&
                    isNonEmpty(doc.date_of_birth?.year)
                ) {
                    activityRecords.push({
                        user_id,
                        fb_user_id,
                        created_at: createdAt,
                        activity_type: ACTIVITY_TYPE_BIRTHDAY,
                        action: ACTION_ADDED,
                        friendFbId,
                         script10: true ,
                        activity_info: { oldValue: null, newValue: doc.date_of_birth },
                    });
                }

                // Gender tracker
                const gender = doc.gender || doc.friendGender;
                if (isValidGender(gender)) {
                    activityRecords.push({
                        user_id,
                        fb_user_id,
                        created_at: createdAt,
                        activity_type: ACTIVITY_TYPE_GENDER,
                        action: ACTION_ADDED,
                        script10: true ,
                        friendFbId,
                        activity_info: { oldValue: null, newValue: gender },
                    });
                }

                // Country tracker (country/tier)
                const country = doc.country;
                const tier = doc.tier;
                if (hasCountryOrTier(country, tier)) {
                    activityRecords.push({
                        user_id,
                        fb_user_id,
                        created_at: createdAt,
                        activity_type: ACTIVITY_TYPE_COUNTRY,
                        action: ACTION_ADDED,
                        script10: true ,
                        friendFbId,
                        activity_info: {
                            oldValue: null,
                            newValue: { country: country || null, tier: tier || null },
                        },
                    });
                }
            }

            if (activityRecords.length === 0) continue;

            await activityCollection.insertMany(activityRecords);
            totalInserted += activityRecords.length;
            console.log(`Profile user_id=${user_id}: added ${activityRecords.length} activity records (Non friend fields).`);
        }

        console.log(`Done. Total activity records inserted: ${totalInserted}.`);
    } catch (error) {
        console.error('Error:', error);
        throw error;
    } finally {
        await client.close();
    }
}

runNonFriendFieldsTracker().catch(console.error);

