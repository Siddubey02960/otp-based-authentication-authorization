const AWS = require('aws-sdk');

// Credentials are read from the environment or the shared AWS config.
// Set AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, and optionally AWS_REGION.
AWS.config.update({
  region: process.env.AWS_REGION || 'us-east-1',
});


const lambda = new AWS.Lambda();

async function deleteOldVersionsForAllFunctions() {
  try {
    let functions = [];
    let marker;

    console.log('Fetching all Lambda functions...\n'); 

    // 1️⃣ Fetch all functions (pagination safe)
    do {
      const res = await lambda.listFunctions({
        Marker: marker
      }).promise();

      functions = functions.concat(res.Functions);
      marker = res.NextMarker;

    } while (marker);

    console.log(`Found ${functions.length} functions.\n`);

    // 2️⃣ Loop through each function
    for (const func of functions) {
      const functionName = func.FunctionName; 
      console.log(`Processing: ${functionName}`);

      try {
        let versions = [];
        let vMarker;

        // Fetch all versions of this function
        do {
          const res = await lambda.listVersionsByFunction({
            FunctionName: functionName,
            Marker: vMarker
          }).promise();

          versions = versions.concat(res.Versions);
          vMarker = res.NextMarker;

        } while (vMarker);

        const publishedVersions = versions
          .filter(v => v.Version !== '$LATEST')
          .map(v => parseInt(v.Version))
          .sort((a, b) => b - a);

        if (publishedVersions.length === 0) {
          console.log('  No published versions.\n');
          continue;
        }

        const latestVersion = publishedVersions[0];
        console.log(`  Keeping latest version: ${latestVersion}`);

        for (let version of publishedVersions) {
          if (version !== latestVersion) {
            console.log(`  Deleting version ${version}...`);

            await lambda.deleteFunction({
              FunctionName: functionName,
              Qualifier: version.toString()
            }).promise();

            console.log(`  Deleted version ${version}`);
          }
        }

        console.log('  Done.\n');

      } catch (err) {
        console.error(`  Error processing ${functionName}:`, err.message, '\n');
      }
    }

    console.log('All functions processed ✅');

  } catch (err) {
    console.error('Fatal Error:', err);
  }
}

deleteOldVersionsForAllFunctions();

