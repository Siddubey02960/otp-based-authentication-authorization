const { MongoClient } = require('mongodb');
 
const uri = 'mongodb+srv://FR_SECRET_DEV:eQUqwXAHSGjRLfGJ@cluster0.u2quf8g.mongodb.net/';
//const uri = 'mongodb+srv://FR_SECRET_READ_BETA:wjbQ3Pr1ZUPeDZ46@fr-frlst-beta.qricz.mongodb.net/'
 
async function addDefaultPostTypes() {   
    require("dns").setDefaultResultOrder("ipv4first");
     const client = new MongoClient(uri, {
        serverSelectionTimeoutMS: 30000,
        tls: true,
    });   
                                   
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
                     user_id: {$in: [2428]},
                    fb_auth_info: { $ne: null }, 
                    fb_user_id: { $ne: null }, 
                 }
                },
                { 
                    $sort: { user_id: 1 }
                }
            ]).toArray(); 
 
        
        let contactObj = []; 

        for (const profile of profiles) {
           // get the Unlabeled post type by user_id , fb_user_id, title: "Unlabeled"

           //then add the _id of the post to all the posts also in Unlabeled add the post_ids i 
 
           // 1️⃣ Get Unlabeled post type
           console.log("user_id",profile.user_id)
            
           const PostType = await postTypesCollections.findOne({
                user_id: profile.user_id,
                fb_user_id: profile.fb_user_id,  
                title: "Unlabeled",
                post_ids: []
            }); 

            if (!unlabeledPostType) continue;


            // 2️⃣ Get all engagement posts for user
            const engagements = await EngagementCollections.find({
                 user_id: profile.user_id,
                 user_fb_id: profile.fb_user_id,
                 postId: { $ne: null },
                 postUrl: { $nin: [null, ''] },
                 author: profile.fb_user_id,
            }).toArray();

            if (!engagements.length) continue;

            const postIds = engagements.map((e) => e._id)

            // 3️⃣ Replace post_ids in Unlabeled post type (removes earlier ones)
            await postTypesCollections.updateOne( 
                { _id: unlabeledPostType._id },
                {
                $addToSet: { post_ids: { $each: postIds } },
                $set: { updated_at: now },
                }
            ); 

            // 4️⃣ Update all engagements → set post_type_id 
            await EngagementCollections.updateMany(
                {
                    // user_id: profile.user_id,
                    // user_fb_id: profile.fb_user_id,
                    _id: { $in: postIds}
                },
                {
                $set: {
                    post_type_id: unlabeledPostType._id,
                    updated_at: now,
                },
                }
            );

            console.log("user_id",profile.user_id)
        }

           
        }
    catch (error) {
        console.error('Error:', error);
    } finally {
        await client.close(); // Ensure the client is closed
    }
}

addDefaultPostTypes().catch(console.error);


