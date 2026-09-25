/**
 * Add `title` to `note_data` for previously stored note activities (activity_type 16).
 *
 * Previous structure:
 * {
 *   activity_type: 16,
 *   note_data: {
 *     noteText: "Note 1",
 *     text: "Note 1",
 *     __raw: "...",
 *     html: "Note 1"
 *   }
 * }
 *
 * New structure (what we want in activity):
 * {
 *   activity_type: 16,
 *   note_data: {
 *     noteText: "...",
 *     text: "...",
 *     __raw: "...",
 *     html: "...",
 *     title: "Some title"
 *   }
 * }
 *
 * This script:
 * - Fetches all notes (from `notes` collection) once with only `_id` and `title`
 * - Builds a map noteId -> title
 * - Scans `activity` collection for activity_type 16 documents
 * - Only updates documents where `note_data` exists and `note_data.title` is missing/empty
 * - Sets `note_data.title` from the notes map (or '' if not found)
 */

const { MongoClient } = require('mongodb');
require('dotenv').config();

// Same URI style as other migration scripts
const uri = 'mongodb+srv://FR_SECRET_READ_BETA:wjbQ3Pr1ZUPeDZ46@fr-frlst-beta.qricz.mongodb.net/';
// const uri = 'mongodb+srv://FR_SECRET_READ_BETA:wjbQ3Pr1ZUPeDZ46@fr-frlst-beta.qricz.mongodb.net/';

const dbName = process.env.DATABASE_NAME || 'fr_profile';

const ACTIVITY_TYPE_NOTE = 16;

/** Returns true if note_data.title is missing, null, or empty string. */
function needsTitle(noteData) {
    if (!noteData || typeof noteData !== 'object') return false;
    if (!Object.prototype.hasOwnProperty.call(noteData, 'title')) return true;
    const val = noteData.title;
    return val == null || String(val).trim() === '';
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
        const activityCollection = database.collection('activity');
        const notesCollection = database.collection('notes');

        // 1. Fetch all notes (_id and title only) and build a lookup map
        const notes = await notesCollection
            .find({}, { projection: { title: 1 } })
            .toArray();

        const noteTitleMap = new Map();
        for (const note of notes) {
            const idStr = note._id.toString();
            const title =
                note.title != null && String(note.title).trim() !== ''
                    ? String(note.title).trim()
                    : '';
            noteTitleMap.set(idStr, title);
        }

        console.log(`Loaded ${notes.length} notes into title map.`);

        // Find note activities with note_data present and title missing/empty
        const cursor = activityCollection.find({
            activity_type: ACTIVITY_TYPE_NOTE,
            note_data: { $exists: true, $ne: null },
            $or: [
                { 'note_data.title': { $exists: false } },
                { 'note_data.title': null },
                { 'note_data.title': '' },
            ],
        });

        let totalUpdated = 0;

        while (await cursor.hasNext()) {
            const activity = await cursor.next();
            const noteData = activity.note_data;

            if (!needsTitle(noteData)) {
                continue;
            }

            // note_id can be an ObjectId; normalize to string for lookup
            const noteId = activity.note_id;
            const noteIdStr =
                noteId && typeof noteId.toString === 'function'
                    ? noteId.toString()
                    : '';

            const titleFromNote =
                noteIdStr && noteTitleMap.has(noteIdStr)
                    ? noteTitleMap.get(noteIdStr)
                    : '';

            const title = titleFromNote;

            await activityCollection.updateOne(
                { _id: activity._id },
                {
                    $set: {
                        'note_data.title': title,
                        script4: true 
                    },
                }
            );

            totalUpdated++;
        }

        console.log(
            `Done. Total activity_type=${ACTIVITY_TYPE_NOTE} records updated with note_data.title: ${totalUpdated}.`
        );
    } catch (error) {
        console.error('Error:', error);
        throw error;
    } finally {
        await client.close();
    }
}

run().catch(console.error);

