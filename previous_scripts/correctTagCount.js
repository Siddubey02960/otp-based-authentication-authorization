const { MongoClient } = require('mongodb');

//const url = 'mongodb+srv://FR_DEV:868hBJaLUnPjsu6b@fr-frlst-beta.qricz.mongodb.net/?retryWrites=true&w=majority';
const uri = 'mongodb+srv://FR_SECRET_READ_BETA:drCnAAxnGpwFi2tH@fr-frlst-beta.qricz.mongodb.net/'

async function correctLabelCount() { 
    const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true });
                
    try {   
        await client. connect(); // Connect to the MongoDB server

        const database = client.db('fr_profile');
        const profileCollections = database.collection('profiles');
        const friendListsCollections = database.collection('friend_lists');
        const tagCollections = database.collection('tags'); // Ensure this is the correct collection
    
            const profiles = await profileCollections.aggregate([
                {
                 $match: { 
                    user_id: 1909,
                    fb_auth_info: { $ne: null }, 
                    fb_user_id: { $ne: null }, 
                    // label_count_updated: { $nin: [true]},
                 }
                },
                { 
                    $sort: { user_id: 1 }           // sort by user_id ascending
                }, 
                {
                    $project: {
                    user_id: 1,
                    fb_user_id: 1                 // return only these fields
                    }
                }
            ]).toArray(); 
 
            console.log("profle",profiles);

        for(let i =0; i < profiles.length; i++){
            let tags = await tagCollections.aggregate([
                { 
                  $match:{
                    user_id: profiles[i].user_id,
                    fb_user_id: profiles[i].fb_user_id,
                    deleted_at: { $in: [null, '']}
                   }
                },
                {
                    $project: {
                        _id:1,
                        title: 1
                    }
                }
            ]).toArray()

            for(let j = 0; j< tags.length; j++){

            let friendData = await friendListsCollections.aggregate([
                {
                    $match: {
                        user_id: profiles[i].user_id,
                        fb_user_id: profiles[i].fb_user_id,
                        tags: {$in: [tags[j]._id]},
                        friendStatus: {$nin: ['Deactivate']}
                    }
                },
                {
                    $project: {
                        _id:1
                    }
                }
            ]).toArray()

            let contactIds = friendData.map((elem) => elem._id)


            
            let updateObj = {
                $set: {
                    contact_ids: contactIds
                }
            }
          
            await  tagCollections.updateOne({_id: tags[j]._id}, updateObj);

            }

            //await profileCollections.updateOne({user_id: profiles[i].user_id}, { $set: {label_count_updated: true}});
            console.log(i, profiles[i].user_id)
        }
    } catch (error) {
        console.error('Error:', error);
    } finally {
        await client.close(); // Ensure the client is closed
    }
}

correctLabelCount().catch(console.error);