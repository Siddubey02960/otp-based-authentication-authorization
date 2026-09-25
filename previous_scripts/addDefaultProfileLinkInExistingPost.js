const { MongoClient } = require('mongodb');

//const uri = 'mongodb+srv://FR_SECRET_DEV:KxZLWdg5dwOfGB1i@cluster0.u2quf8g.mongodb.net/';
const uri = 'mongodb+srv://FR_SECRET_READ_BETA:wjbQ3Pr1ZUPeDZ46@fr-frlst-beta.qricz.mongodb.net/'

async function correctPostTypeCount() {
    const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true });

    try {
        console.log("Script started 1");
        await client.connect();   

        const database = client.db('fr_profile');
        const profileCollections = database.collection('profiles');
        const fbLinkCollections = database.collection('facebook_links');
        const EngagementCollections = database.collection('engagements');
        let now = new Date().toISOString().slice(0, 19).replace("T", " ");

        console.log("Script started 2");

        const profiles = await profileCollections.aggregate([
            {
                $match: { 
                    user_id: { $gt: 3304 },
                    fb_auth_info: { $ne: null },
                    fb_user_id: { $ne: null },
                }
            },
            {
                $sort: { user_id: 1 }
            }
        ]).toArray();

        console.log(profiles.length);
        for (const profile of profiles) {
            console.log("Processing user_id:", profile.user_id);

            const defaultLink = await fbLinkCollections.findOne({
                        user_id: profile.user_id,
                        fb_user_id: profile.fb_user_id,
                        name: 'My Profile',
                        deleted_at: { $in: [null, ""] },
                    });

            console.log("defautlLink", JSON.stringify(defaultLink));

            if (!defaultLink) continue;

            let engagementQuery = {
                    user_id: profile.user_id,
                    user_fb_id: profile.fb_user_id,
                    deleted_at: { $in: [null, ""] },
                    postId: { $ne: null },
                    postUrl: { $nin: [null, ''] },
                    author: profile.fb_user_id,
                    post_type: {$in: [0, null]}
                }


                const engagements = await EngagementCollections.find(engagementQuery).toArray();

                // console.log('enagements', JSON.stringify(engagements));
                
                if (!engagements.length) continue;

                const postIds = engagements.map((e) => e._id); 

                await EngagementCollections.updateMany(
                    { _id: {$in: postIds} },
                    {
                        $set: {
                            where_to_post: [defaultLink._id],
                        }
                    }
                );

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



