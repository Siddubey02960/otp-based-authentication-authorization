const { MongoClient } = require('mongodb');
const fs = require('fs');

//const uri = 'mongodb+srv://FR_SECRET_DEV:eQUqwXAHSGjRLfGJ@cluster0.u2quf8g.mongodb.net/';
const uri = 'mongodb+srv://FR_SECRET_READ_BETA:wjbQ3Pr1ZUPeDZ46@fr-frlst-beta.qricz.mongodb.net/'

let userId = 1909;
let fbUserId = "100067189421485";
async function getFilteredPostData() { 
    const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true });
        
    try {     
        await client. connect(); 
        const database = client.db('fr_profile'); 
        const engagementCollections = database.collection('engagements');
        let now = new Date().toISOString().slice(0, 19).replace("T", " ");
 
        const postData = await engagementCollections.aggregate([
                {
                 $match: {
                    user_id: 1909,
                    user_fb_id: "100067189421485",
                    postId: { $ne: null },
      postUrl: { $nin: [null, ''] }
                    }
                },
                { 
                    $project: {
                        _id: 0,
                        postText: 1,
                        comments: {
                            $map: {
                                input: "$comments",
                                as: "comment",
                                in: "$$comment.comment_text"
                            }
                        }
                    }
                }
        ]).toArray(); 
 
        fs.writeFileSync('postData_output.json', JSON.stringify(postData, null, 2));
        console.log('Output written to postData_output.json');
        }
    catch (error) {
        console.error('Error:', error);
    } finally {
        await client.close(); // Ensure the client is closed
    }
}

getFilteredPostData().catch(console.error);


