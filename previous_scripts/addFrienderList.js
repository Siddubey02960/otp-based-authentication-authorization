const { MongoClient } = require('mongodb');

const uri = 'mongodb+srv://FR_SECRET_DEV:eQUqwXAHSGjRLfGJ@cluster0.u2quf8g.mongodb.net/';
//const uri = 'mongodb+srv://FR_SECRET_READ_BETA:wjbQ3Pr1ZUPeDZ46@fr-frlst-beta.qricz.mongodb.net/'


async function correctLabelCount() { 
    const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true });
       
    try {     
        await client. connect(); // Connect to the MongoDB server  
  
        const database = client.db('fr_profile'); 
        const profileCollections = database.collection('profiles');
        const frienderUserollections = database.collection('friender_user_list');
        let now = new Date().toISOString().slice(0, 19).replace("T", " ");
 
    
            const profiles = await profileCollections.aggregate([
                {
                 $match: { 
                    user_id: {$ne: null},
                    fb_auth_info: { $ne: null }, 
                    fb_user_id: { $ne: null }, 
                 }
                },
                { 
                    $sort: { user_id: 1 }
                }
            ]).toArray(); 
 
        
        let contactObj = [];

        for(let i =0; i < profiles.length; i++){
            if(i ==0){
             console.log(profiles[i]);
            }
           
           let payload = {
                "user_id": profiles[i].user_id,
                "fb_user_id": profiles[i].fb_user_id,
                "user_name": profiles[i]?.name,
                 profileUrl:  profiles[i]?.fb_profile_url,
                 profilePicture:  profiles[i]?.fb_profile_picture,
                "finalSource": "Frienders",
                "status": 1, 
                "is_visible": true,
                "added_to_friender":  profiles[i]?.created_at,
                "updated_at": now,
                "created_at": now
             }
            contactObj.push(payload);
        }

        if (contactObj.length > 0) {
            await frienderUserollections.insertMany(contactObj);
        }
        }
    catch (error) {
        console.error('Error:', error);
    } finally {
        await client.close(); // Ensure the client is closed
    }
}

correctLabelCount().catch(console.error);


