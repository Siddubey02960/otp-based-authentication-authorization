/**
 * addSyncFriendTracker script
 * Gets all profiles, finds friend_lists where friendStatus is "Activate", deleted_status is 0,
 * source is "Sync", and document has friendFbId and fb_user_id.
 * Adds those to the activity collection in fr_profile db.
 */

const { MongoClient } = require('mongodb');
require('dotenv').config();

// Connection URI
const uri = 'mongodb+srv://FR_SECRET_DEV:KxZLWdg5dwOfGB1i@cluster0.u2quf8g.mongodb.net/';

// Database details
const dbName = 'fr_profile';

// Activity types and actions
const ACTIVITY_TYPE_FRIEND_STATUS_CHANGED = 17;
const ACTIVITY_TYPE_BIRTHDAY = 5;
const ACTIVITY_TYPE_GENDER = 11;
const ACTIVITY_TYPE_COUNTRY = 12;

const ACTION_UPDATED = 3;
const ACTION_ADDED = 1;

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

async function runSyncFriendTracker() {
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
                user_id: {$eq: 1909},
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

            // 2. Get friend_lists matching criteria
            const friendRecords = await friendListsCollection
                .find({
                    user_id,
                    fb_user_id,
                    friendStatus: 'Activate',
                    deleted_status: 0,
                    source: {$in: ['Incoming Request', 'Sync']},
                    friendFbId: { $exists: true, $nin: [null, ''] },
                    lost_at: {$exists: false}
                })
                .toArray();

            if (friendRecords.length === 0) continue;

            const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
            const activityRecords = [];

            for (const doc of friendRecords) {
                const createdAt = doc.created_at || now;
                const friendFbId = doc.friendFbId ? doc.friendFbId.toString() : null;
                if (!friendFbId) continue;

                // Friend status changed -> Friend
                activityRecords.push({
                    user_id,
                    fb_user_id,
                    created_at: createdAt,
                    activity_type: ACTIVITY_TYPE_FRIEND_STATUS_CHANGED,
                    action: ACTION_UPDATED,
                    script: true,
                    friendFbId,
                    activity_info: { oldValue: null, newValue: 'Friend' },
                });

                // Birthday tracker (date_of_birth)
                if (
                    isNonEmpty(doc.date_of_birth?.day) ||
                    isNonEmpty(doc.date_of_birth?.month) ||
                    isNonEmpty(doc.date_of_birth?.year)
                ) {
                    activityRecords.push({
                        user_id,
                        fb_user_id,
                        created_at: createdAt,
                        activity_type: ACTIVITY_TYPE_BIRTHDAY,
                        action: ACTION_ADDED,
                        script: true,
                        friendFbId,
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
                        script: true,
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
                        script: true,
                        friendFbId,
                        activity_info: { oldValue: null, newValue: { country: country || null, tier: tier || null } },
                    });
                }
            }

            if (activityRecords.length > 0) {
                await activityCollection.insertMany(activityRecords);
                totalInserted += activityRecords.length;
                console.log(`Profile user_id=${user_id}: added ${activityRecords.length} activity records (Friend + fields).`);
            }
        }

        console.log(`Done. Total activity records inserted: ${totalInserted}.`);
    } catch (error) {
        console.error('Error:', error);
        throw error;
    } finally {
        await client.close();
    }
}

runSyncFriendTracker().catch(console.error);
