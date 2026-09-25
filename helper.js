const { mongo } = require("fr-mongodb");
const { activity_type, action } = require('../src/const/index');
const { blacklist } = require("validator");

const whitelistTracker = async function ({ user_id, fb_user_id, friend_ids, identifier, location }) {
    let now = new Date().toISOString().slice(0, 19).replace("T", " ");

    await mongo.init(
        process.env.DATABASE_READ_HOST,
        10,
        process.env.DATABASE_NAME,
        "activity"
    );

    // bulk update for contacts that were updated as whitelisted
    let records = [];
    let action_type;

    if (identifier === action.added) {
        action_type = action.added;
    } else {
        action_type = action.removed;
    }

    for (let i = 0; i < friend_ids.length; i++) {
        let activityData = {
            user_id,
            fb_user_id,
            created_at: now,
            activity_type: activity_type.whitelist,
            action: action_type,
            location,
            friend_id: friend_ids[i].toString()// Assign specific friend's ID
        }
        records.push(activityData);
    }

    await mongo.insertMany(records);
    return true;
};

const blacklistTracker = async function ({ user_id, fb_user_id, friend_ids, identifier, location }) {
    let now = new Date().toISOString().slice(0, 19).replace("T", " ");

    await mongo.init(
        process.env.DATABASE_READ_HOST,
        10,
        process.env.DATABASE_NAME,
        "activity"
    );

    // bulk update for contacts that were updated as whitelisted
    let records = [];
    let action_type;

    if (identifier === action.added) {
        action_type = action.added;
    } else {
        action_type = action.removed;
    }



    for (let i = 0; i < friend_ids.length; i++) {
        let activityData = {
            user_id,
            fb_user_id,
            created_at: now,
            activity_type: activity_type.blacklist,
            action: action_type,
            location,
            friend_id: friend_ids[i].toString()// Assign specific friend's ID
        };
        records.push(activityData);
    }

    await mongo.insertMany(records);
    return true;
};

const genderTracker = async function ({ user_id, fb_user_id, friend_ids, old_value, new_value, tracker_action }) {
    let now = new Date().toISOString().slice(0, 19).replace("T", " ");

    await mongo.init(
        process.env.DATABASE_READ_HOST,
        10,
        process.env.DATABASE_NAME,
        "activity"
    );

    // bulk update for contacts that were updated as whitelisted
    let records = [];

    for (let i = 0; i < friend_ids.length; i++) {
        let activityData = {
            user_id,
            fb_user_id,
            created_at: now,
            activity_type: activity_type.gender,
            action: tracker_action || action.updated,
            activity_info: { oldValue: old_value, newValue: new_value },
            friendFbId: friend_ids[i].toString()
        };

        records.push(activityData);
    }

    await mongo.insertMany(records);
    return true;
};

const birthdayTracker = async function ({ user_id, fb_user_id, friend_ids, old_value, new_value, tracker_action }) {
    let now = new Date().toISOString().slice(0, 19).replace("T", " ");

    await mongo.init(
        process.env.DATABASE_READ_HOST,
        10,
        process.env.DATABASE_NAME,
        "activity"
    );

    // bulk update for contacts that were updated as whitelisted
    let records = [];



    for (let i = 0; i < friend_ids.length; i++) {
        let activityData = {
            user_id,
            fb_user_id,
            created_at: now,
            activity_type: activity_type.birthday,
            action: tracker_action || action.updated,
            activity_info: { oldValue: old_value, newValue: new_value },
            friendFbId: friend_ids[i].toString()
        };

        records.push(activityData);
    }

    await mongo.insertMany(records);
    return true;
};

const countryTracker = async function ({ user_id, fb_user_id, friend_ids, old_value, new_value, tracker_action }) {
    let now = new Date().toISOString().slice(0, 19).replace("T", " ");

    await mongo.init(
        process.env.DATABASE_READ_HOST,
        10,
        process.env.DATABASE_NAME,
        "activity"
    );

    // bulk update for contacts that were updated as whitelisted
    let records = [];



    for (let i = 0; i < friend_ids.length; i++) {
        let activityData = {
            user_id,
            fb_user_id,
            created_at: now,
            activity_type: activity_type.country,
            action: tracker_action || action.updated,
            activity_info: { oldValue: old_value, newValue: new_value },
            friendFbId: friend_ids[i].toString()
        };
        records.push(activityData);
    }

    await mongo.insertMany(records);
    return true;
};

const queueTracker = async function ({ user_id, fb_user_id, friend_ids }) {
    let now = new Date().toISOString().slice(0, 19).replace("T", " ");

    await mongo.init(
        process.env.DATABASE_READ_HOST,
        10,
        process.env.DATABASE_NAME,
        "activity"
    );

    let records = [];

    for (let i = 0; i < friend_ids.length; i++) {
        let activityData = {
            user_id,
            fb_user_id,
            created_at: now,
            activity_type: activity_type.queue,
            action: action.added,
            friend_id: friend_ids[i].toString()
        };
        records.push(activityData);
    }

    await mongo.insertMany(records);
    return true;
};

const removeContactFromQueue = async function ({ user_id, fb_user_id, friendFbIds }) {
    let now = new Date().toISOString().slice(0, 19).replace("T", " ");

    await mongo.init(
        process.env.DATABASE_READ_HOST,
        10,
        process.env.DATABASE_NAME,
        "activity"
    );

    let records = [];

    for (let i = 0; i < friendFbIds.length; i++) {
        let activityData = {
            user_id,
            fb_user_id,
            created_at: now,
            activity_type: activity_type.queue,
            action: action.removed,
            friendFbId: friendFbIds[i].toString()
        };
        records.push(activityData);
    }

    if (records.length > 0) {
        await mongo.insertMany(records);
    }
    return true;
};

const moveToTopContactFromQueue = async function ({ user_id, fb_user_id, friend_ids }) {
    let now = new Date().toISOString().slice(0, 19).replace("T", " ");

    await mongo.init(
        process.env.DATABASE_READ_HOST,
        10,
        process.env.DATABASE_NAME,
        "activity"
    );

    let records = [];

    for (let i = 0; i < friend_ids.length; i++) {
        let activityData = {
            user_id,
            fb_user_id,
            created_at: now,
            activity_type: activity_type.queue,
            action: action.moved_to_top,
            friendFbId: friend_ids[i]
        };
        records.push(activityData);
    }

    if (records.length > 0) {
        await mongo.insertMany(records);
    }
    return true;
};

/**
 * Adds activity entries when friend_lists records are inserted with date_of_birth, gender, and country/tier.
 * Only records that have all three fields present will get activity entries.
 */
const profileFieldsInsertTracker = async function ({ user_id, fb_user_id, insertedRecords }) {
    if (!insertedRecords || insertedRecords.length === 0) return true;

    let now = new Date().toISOString().slice(0, 19).replace("T", " ");
    let records = [];

    for (const doc of insertedRecords) {
        const dateOfBirth = doc?.date_of_birth;
        const gender = doc?.gender || doc?.friendGender;
        const country = doc?.country;
        const tier = doc?.tier;
        const hasCountryOrTier = (country && country !== '' && country !== ' ' && country !== 'NA') ||
            (tier && tier !== '' && tier !== ' ' && tier !== 'NA');
        const hasValidGender = gender && !['', 'NA', 'UNKNOWN'].includes(String(gender).toUpperCase());

        if (!dateOfBirth || !hasValidGender || !hasCountryOrTier) continue;

        const friendId = (doc._id || doc).toString();

        records.push({
            user_id,
            fb_user_id,
            created_at: now,
            activity_type: activity_type.birthday,
            action: action.added,
            activity_info: { oldValue: null, newValue: dateOfBirth },
            friend_id: friendId
        });
        records.push({
            user_id,
            fb_user_id,
            created_at: now,
            activity_type: activity_type.gender,
            action: action.added,
            activity_info: { oldValue: null, newValue: gender },
            friend_id: friendId
        });
        records.push({
            user_id,
            fb_user_id,
            created_at: now,
            activity_type: activity_type.country,
            action: action.added,
            activity_info: { oldValue: null, newValue: { country: country || null, tier: tier || null } },
            friend_id: friendId
        });
    }

    if (records.length > 0) {
        await mongo.init(
            process.env.DATABASE_READ_HOST,
            10,
            process.env.DATABASE_NAME,
            "activity"
        );
        await mongo.insertMany(records);
    }
    return true;
};

const commentTracker = async function ({ user_id, fb_user_id, friendFbId, post_info }) {
    let now = new Date().toISOString().slice(0, 19).replace("T", " ");

    await mongo.init(
        process.env.DATABASE_READ_HOST,
        10,
        process.env.DATABASE_NAME,
        "activity"
    );

    let records = [{
        user_id,
        fb_user_id,
        created_at: now,
        activity_type: activity_type.comment,
        action: action.commented,
        friendFbId: friendFbId,
        activity_info: post_info
    }];

    await mongo.insertMany(records);
    return true;
};

const reactionTracker = async function ({ user_id, fb_user_id, friendFbId, post_info }) {
    let now = new Date().toISOString().slice(0, 19).replace("T", " ");

    await mongo.init(
        process.env.DATABASE_READ_HOST,
        10,
        process.env.DATABASE_NAME,
        "activity"
    );

    let records = [{
        user_id,
        fb_user_id,
        created_at: now,
        activity_type: activity_type.reaction,
        action: action.reacted,
        friendFbId: friendFbId,
        activity_info: post_info
    }];

    await mongo.insertMany(records);
    return true;
};

const friendStatusTracker = async function ({ user_id, fb_user_id, records }) {
    if (!records || records.length === 0) return true;
    let now = new Date().toISOString().slice(0, 19).replace("T", " ");

    await mongo.init(
        process.env.DATABASE_READ_HOST,
        10,
        process.env.DATABASE_NAME,
        "activity"
    );

    const activityRecords = records.map(({ friend_id, friendFbId, old_value, new_value }) => {
        let record = {
            user_id,
            fb_user_id,
            created_at: now,
            activity_type: activity_type.friendStatusChanged,
            action: action.updated,
            activity_info: { oldValue: old_value, newValue: new_value }
        };
        if (friend_id) record.friend_id = friend_id.toString();
        if (friendFbId) record.friendFbId = friendFbId.toString();
        return record;
    });

    await mongo.insertMany(activityRecords);
    return true;
};

const unfriendTracker = async function ({ user_id, fb_user_id, friendFbId }) {
    let now = new Date().toISOString().slice(0, 19).replace("T", " ");

    await mongo.init(
        process.env.DATABASE_READ_HOST,
        10,
        process.env.DATABASE_NAME,
        "activity"
    );

    let records = [{
        user_id,
        fb_user_id,
        created_at: now,
        activity_type: activity_type.Unfriend,
        action: action.added,
        friendFbId,
        activity_info: { oldValue: "Friend", newValue: "Unfriend" },
    }];

    await mongo.insertMany(records);
    return true;
};

const friendRequestSentTracker = async function ({ user_id, fb_user_id, friendFbId }) {
    let now = new Date().toISOString().slice(0, 19).replace("T", " ");

    await mongo.init(
        process.env.DATABASE_READ_HOST,
        10,
        process.env.DATABASE_NAME,
        "activity"
    );

    let records = [{
        user_id,
        fb_user_id,
        created_at: now,
        activity_type: activity_type.friendRequestSent,
        action: action.added,
        friendFbId
    }];

    await mongo.insertMany(records);
    return true;
};

const friendRequestAcceptedTracker = async function ({ user_id, fb_user_id, friendFbId, action_type }) {
    let now = new Date().toISOString().slice(0, 19).replace("T", " ");

    await mongo.init(
        process.env.DATABASE_READ_HOST,
        10,
        process.env.DATABASE_NAME,
        "activity"
    );

    let records = [];
    for (let i = 0; i < friendFbId.length; i++) {
        let activityData = {
            user_id,
            fb_user_id,
            created_at: now,
            activity_type: activity_type.friendRequestAccepted,
            action: action_type || action.added,
            friendFbId: friendFbId[i]
        };
        records.push(activityData);
    }
    if (records.length > 0) {
        await mongo.insertMany(records);
    }
    return true;
};

const campaignContactTracker = async function ({ user_id, fb_user_id, friendFbIds, campaign_id, campaign_name, identifier }) {
    let now = new Date().toISOString().slice(0, 19).replace("T", " ");

    await mongo.init(
        process.env.DATABASE_READ_HOST,
        10,
        "fr_profile",
        "activity"
    );

    let records = [];

    if (identifier === action.added) {
        action_type = action.added;
    } else {
        action_type = action.removed;
    }

    if (friendFbIds?.length >0) {
        for (let i = 0; i < friendFbIds.length; i++) {
            let activityData = {
                user_id,
                fb_user_id,
                created_at: now,
                activity_type: activity_type.campaign,
                action: action_type,
                campaign_id,
                campaign_name: campaign_name ?? '',
                friendFbId: friendFbIds[i]
            };
            records.push(activityData);
        }
    }

    if (records[0]) {
        await mongo.insertMany(records);
    }

};

const messageTracker = async function ({ user_id, fb_user_id, friendFbId, message, setting_type, campiagn_id, status }) {
    let now = new Date().toISOString().slice(0, 19).replace("T", " ");

    // await mongo.init(
    //     process.env.DATABASE_READ_HOST,
    //     10,
    //     "fr_profile",
    //     "friend_lists"
    // );

    //const friendDetail = await mongo.findByQuery({ fb_user_id, friendFbId, user_id });

    await mongo.init(
        process.env.DATABASE_READ_HOST,
        10,
        "fr_profile",
        "activity"
    );

    let records = [];

    let activityData = {
        user_id,
        fb_user_id,
        created_at: now,
        activity_type: 8,
        action: 7,
        friendFbId: friendFbId,
        message: message,
        setting_type: setting_type,
        status
    }
    if(status == "failed"){
     activityData.action = 8
    }
    if (campiagn_id) {
        activityData.campiagn_id = campiagn_id;
    }
    records.push(activityData);


    await mongo.insertMany(records);
    return true;
};

module.exports = {
    whitelistTracker,
    blacklistTracker,
    genderTracker,
    birthdayTracker,
    countryTracker,
    queueTracker,
    unfriendTracker,
    removeContactFromQueue,
    moveToTopContactFromQueue,
    profileFieldsInsertTracker,
    commentTracker,
    reactionTracker,
    friendRequestSentTracker,
    friendStatusTracker,
    friendRequestAcceptedTracker,
    campaignContactTracker,
    messageTracker
};