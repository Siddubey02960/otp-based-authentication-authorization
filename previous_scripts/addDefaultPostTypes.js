const { MongoClient } = require('mongodb');

//const uri = 'mongodb+srv://FR_SECRET_DEV:eQUqwXAHSGjRLfGJ@cluster0.u2quf8g.mongodb.net/';
const uri = 'mongodb+srv://FR_SECRET_READ_BETA:wjbQ3Pr1ZUPeDZ46@fr-frlst-beta.qricz.mongodb.net/'


async function addDefaultPostTypes() {  
    const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true });
        
    try {     
        await client. connect(); //Connect to the MongoDB server     
     
        const database = client.db('fr_profile'); 
        const profileCollections = database.collection('profiles');
        const postTypesCollections = database.collection('post_types');
        let now = new Date().toISOString().slice(0, 19).replace("T", " ");
    
    
            const profiles = await profileCollections.aggregate([
                {
                 $match: { 
                    user_id: {$in: [11147, 11140, 11138, 11136, 11135]},
                    fb_auth_info: { $ne: null }, 
                    fb_user_id: { $ne: null }, 
                 }
                },
                { 
                    $sort: { user_id: 1 }
                }
            ]).toArray(); 
 
        
        let contactObj = [];

        const DEFAULT_POST_TYPES =  [
            { title: "Story post", color: "#00A3D5" },
            { title: "Authority post", color: "#5D9CF1" },
            { title: "Connection post", color: "#6470FA" },
            { title: "Value post", color: "#1B55EC" },
            { title: "Engagement post", color: "#FAB363" },
            { title: "Encouragement post", color: "#FCAA00" },
            { title: "Ask post", color: "#D56C00" },
            { title: "Soft sell post", color: "#F78383" },
            { title: "Social proof post", color: "#FF4F4F" },
            { title: "Lead generation post", color: "#FF0100" },
            { title: "Offer post", color: "#0BE445" },
            { title: "Unlabeled", color: "#767485" },
        ];

         const insertDocs = [];

        for (const profile of profiles) {
        for (const type of DEFAULT_POST_TYPES) {
            insertDocs.push({
            user_id: profile.user_id,
            fb_user_id: profile.fb_user_id,
            title: type.title,
            is_default: true,
            color: type.color,
            count: 0,
            created_at: now,
            updated_at: now,
            });
        }
        }

        if (insertDocs.length > 0) {
         await postTypesCollections.insertMany(insertDocs);
        }
           
        }
    catch (error) {
        console.error('Error:', error);
    } finally {
        await client.close(); // Ensure the client is closed
    }
}

addDefaultPostTypes().catch(console.error);


