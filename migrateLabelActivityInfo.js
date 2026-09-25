/**
 * Migrate label activity (activity_type 9) from old format to new format.
 * Old: activity_info: { oldValue: "<labelId>" | ["<labelId>", ...], newValue: "<labelId>" | ["<labelId>", ...] }
 * New: activity_info: { oldValue: [{ title: "", color: "" }, ...], newValue: [{ title: "", color: "" }, ...] }
 *
 * Runs profile-wise:
 * - Fetch profiles
 * - For each profile, fetch that profile's labels to build labelId -> { title, color } map
 * - For that profile, scan label activities in batches and migrate oldValue/newValue to the new shape
 */

const { MongoClient } = require('mongodb');
require('dotenv').config();

const uri = 'mongodb+srv://FR_SECRET_READ_BETA:wjbQ3Pr1ZUPeDZ46@fr-frlst-beta.qricz.mongodb.net/';

//const uri = 'mongodb+srv://FR_SECRET_READ_BETA:wjbQ3Pr1ZUPeDZ46@fr-frlst-beta.qricz.mongodb.net/'
const dbName = process.env.DATABASE_NAME || 'fr_profile';

const ACTIVITY_TYPE_LABEL = 9;
const BATCH_SIZE = 1000;

/** Get label id string for map lookup (handles string or ObjectId). */
function toLabelIdString(val) {
    if (val == null) return '';
    if (typeof val === 'string') return val;
    if (val && typeof val.toString === 'function') return val.toString();
    return '';
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
        const labelsCollection = database.collection('labels');
        const activityCollection = database.collection('activity');

        let totalUpdated = 0;

        const profiles = await profilesCollection
            .find({
                user_id: { $ne: 1909 },
                fb_auth_info: { $ne: null },
                fb_user_id: { $ne: null },
            })
            .project({ user_id: 1, fb_user_id: 1 })
            .sort({ user_id: 1 })
            .toArray();

        console.log(`Found ${profiles.length} profiles.`);

        for (const profile of profiles) {
            const { user_id, fb_user_id } = profile;

            // Fetch labels for this profile and build label map
            const labels = await labelsCollection
                .find({ user_id, fb_user_id }, { projection: { title: 1, color: 1 } })
                .toArray();

            const labelMap = new Map();
            for (const l of labels) {
                labelMap.set(l._id.toString(), { title: l.title || '', color: l.color || '' });
            }

            let profileUpdated = 0;
            let batchIndex = 0;

            const resolveOne = (val) => {
                if (val == null) return { title: '', color: '' };
                if (typeof val === 'object' && !Array.isArray(val) && 'title' in val) {
                    return { title: val.title || '', color: val.color || '' };
                }
                const id = toLabelIdString(val);
                return id ? (labelMap.get(id) || { title: '', color: '' }) : { title: '', color: '' };
            };

            const resolveToArray = (val) => {
                if (val == null) return [];
                if (Array.isArray(val)) return val.map(resolveOne);
                return [resolveOne(val)];
            };

            while (true) {
                const skip = batchIndex * BATCH_SIZE;
                const activities = await activityCollection
                    .find({
                        user_id,
                        fb_user_id,
                        activity_type: ACTIVITY_TYPE_LABEL,
                        activity_info: { $exists: true, $ne: null },
                        // Not yet migrated (supports scalar and array shapes)
                        $or: [
                            { 'activity_info.oldValue': { $exists: true, $ne: null }, 'activity_info.oldValue.title': { $exists: false } },
                            { 'activity_info.newValue': { $exists: true, $ne: null }, 'activity_info.newValue.title': { $exists: false } },
                            { 'activity_info.oldValue.0': { $exists: true }, 'activity_info.oldValue.0.title': { $exists: false } },
                            { 'activity_info.newValue.0': { $exists: true }, 'activity_info.newValue.0.title': { $exists: false } },
                        ],
                    })
                    .skip(skip)
                    .limit(BATCH_SIZE)
                    .toArray();

                if (activities.length === 0) {
                    if (batchIndex === 0) {
                        // no work for this profile
                    } else {
                        console.log(`Profile user_id=${user_id}: no more documents. Stopping.`);
                    }
                    break;
                }

                console.log(`Profile user_id=${user_id} batch ${batchIndex + 1}: fetched ${activities.length} documents (skip=${skip}).`);

                let batchUpdated = 0;
                for (const activity of activities) {
                    const activityInfo = activity.activity_info;
                    const oldValue = activityInfo.oldValue;
                    const newValue = activityInfo.newValue;
                    const resolvedOld = resolveToArray(oldValue);
                    const resolvedNew = resolveToArray(newValue);

                    await activityCollection.updateOne(
                        { _id: activity._id },
                        {
                            $set: {
                                'activity_info.oldValue': resolvedOld,
                                'activity_info.newValue': resolvedNew,
                                script1: true
                            },
                        }
                    );
                    batchUpdated++;
                }

                profileUpdated += batchUpdated;
                totalUpdated += batchUpdated;
                console.log(`Profile user_id=${user_id} batch ${batchIndex + 1}: updated ${batchUpdated} of ${activities.length}. Profile total: ${profileUpdated}. Global total: ${totalUpdated}.`);

                if (activities.length < BATCH_SIZE) {
                    console.log(`Profile user_id=${user_id} batch ${batchIndex + 1}: last batch (${activities.length} < ${BATCH_SIZE}). Stopping.`);
                    break;
                }

                batchIndex++;
            }

            if (profileUpdated > 0) {
                console.log(`Profile user_id=${user_id}: updated ${profileUpdated} label activity records.`);
            }
        }

        console.log(`Done. Total label activity records updated: ${totalUpdated}.`);
    } catch (error) {
        console.error('Error:', error);
        throw error;
    } finally {
        await client.close();
    }
}

run().catch(console.error);
