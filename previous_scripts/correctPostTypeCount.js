const { MongoClient } = require('mongodb');

const uri = 'mongodb+srv://FR_SECRET_DEV:KxZLWdg5dwOfGB1i@cluster0.u2quf8g.mongodb.net/';
//const uri = 'mongodb+srv://FR_SECRET_READ_BETA:wjbQ3Pr1ZUPeDZ46@fr-frlst-beta.qricz.mongodb.net/'

async function correctPostTypeCount() {
    const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true });

    try {
        await client.connect();

        const database = client.db('fr_profile');
        const profileCollections = database.collection('profiles');
        const postTypesCollections = database.collection('post_types');
        const EngagementCollections = database.collection('engagements');
        let now = new Date().toISOString().slice(0, 19).replace("T", " ");

        const profiles = await profileCollections.aggregate([
            {
                $match: {
                    user_id: { $eq: 2536},
                    fb_auth_info: { $ne: null },
                    fb_user_id: { $ne: null },
                }
            }, 
            {
                $sort: { user_id: 1 }
            }
        ]).toArray();

        for (const profile of profiles) {
            console.log("Processing user_id:", profile.user_id);

            const postTypes = await postTypesCollections.aggregate([
                {
                    $match: {
                        user_id: profile.user_id,
                        fb_user_id: profile.fb_user_id,
                        deleted_at: { $in: [null, ""] },
                    }
                },
                {
                    $project: {
                        _id: 1,
                        title: 1,
                        name: 1
                    }
                }
            ]).toArray();

            //console.log("postTypes", JSON.stringify(postTypes));

            if (!postTypes.length) continue;

            for (let i = 0; i < postTypes.length; i++) {
                let currentPostType = postTypes[i];

                 await postTypesCollections.updateOne(
                    { _id: currentPostType._id },
                    {
                        $set: {
                            post_ids: [],
                        }
                    }
                );

                let engagementQuery = {
                    user_id: profile.user_id,
                    user_fb_id: profile.fb_user_id,
                    deleted_at: { $in: [null, ""] },
                    $or: [
                        // Scheduled posts (not yet posted)
                        // {
                        // scheduled_post: false
                        // },
                        {
                            scheduled_post: true,
                            status: { $in: [1, 2] } // 1: scheduled, 2: failed
                        },
                        // Live posts (already posted)
                        {
                            postId: { $ne: null },
                            postUrl: { $nin: [null, ''] },
                            author: profile.fb_user_id,
                        }
                    ]
                };

                engagementQuery.post_type_id = currentPostType._id;

                const engagements = await EngagementCollections.find(engagementQuery).toArray();
                if (!engagements.length) continue;

                const postIds = engagements.map((e) => e._id); 

                console.log(`Updating post type "${currentPostType.title}" (${currentPostType._id}) with ${postIds.length} posts`);


                await postTypesCollections.updateOne(
                    { _id: currentPostType._id },
                    {
                        $set: {
                            post_ids: postIds,
                            updated_at: now
                        }
                    }
                );
            }

            console.log("Finished user_id:", profile.user_id);
        }

    }
    catch (error) {
        console.error('Error:', error);
    } finally {
        await client.close(); // Ensure the client is closed
    }
}

correctPostTypeCount().catch(console.error);


 
