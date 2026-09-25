/**
 * addFriendStatusTrackerLostAtNull script
 *
 * Profile-wise backfill:
 * - Finds `friend_lists` docs where:
 *   - lost_at is null
 *   - last_friend_at is null OR not present
 *   - source is in ['Incoming Request', 'Sync']
 * - Uses doc.created_at as activity created_at
 * - Inserts friend status changed activity ("Friend" added) with script flag
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
const ACTION_UPDATED = 3;
const ACTION_ADDED = 1;

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

async function run() {
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

        const profiles = await profilesCollection
            .find({
                user_id: 1909,
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

            const cursor = friendListsCollection.find({
                user_id,
                fb_user_id,
                source: { $in: ['Incoming Request', 'Sync'] },
                lost_at: null,
                friendStatus: 'Activate',
                deleted_status: 0,
                $or: [{ last_friend_at: null }, { last_friend_at: { $exists: false } }],
                friendFbId: { $exists: true, $nin: [null, ''] },
                last_non_friend_at: {$eq: null}
            });

            let batch = [];
            let profileInserted = 0;

            while (await cursor.hasNext()) {
                const doc = await cursor.next();
                const friendFbId = doc.friendFbId?.toString?.() ?? null;
                if (!friendFbId) continue;

                const createdAt = doc.created_at;

                batch.push({
                    user_id,
                    fb_user_id,
                    created_at: createdAt,
                    activity_type: ACTIVITY_TYPE_FRIEND_STATUS_CHANGED,
                    action: ACTION_UPDATED,
                    script: true,
                    friendFbId,
                    activity_info: { oldValue: null, newValue: 'Friend' },
                });

                // Birthday tracker (date_of_birth) - store partial DOB if any field present
                if (
                    isNonEmpty(doc.date_of_birth?.day) ||
                    isNonEmpty(doc.date_of_birth?.month) ||
                    isNonEmpty(doc.date_of_birth?.year)
                ) {
                    batch.push({
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
                    batch.push({
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
                    batch.push({
                        user_id,
                        fb_user_id,
                        created_at: createdAt,
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
                    `Profile user_id=${user_id}: inserted ${profileInserted} friend status activity records.`
                );
            }
        }

        console.log(
            `Done. Total friend status activity records inserted: ${totalInserted}.`
        );
    } catch (error) {
        console.error('Error:', error);
        throw error;
    } finally {
        await client.close();
    }
}

run().catch(console.error);

