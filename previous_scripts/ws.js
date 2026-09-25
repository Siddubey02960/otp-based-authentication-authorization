const WebSocket = require("ws");

const token = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6MTkwOSwiZW1haWwiOiJqb25AaWFtbm90YW1hcmtldGVyLmNvbSIsInN0YXR1cyI6IjEiLCJpYXQiOjE3ODQ4ODYwOTQsImV4cCI6MTgxNjQ0MzY5NH0.6CcnuY1OjyZoaV7UMXIPPsV7v9vcbm3tXIaMiG7HfBk";
const token2  ="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6MTkxNCwiZW1haWwiOiJhdW5raXRhQHRpZXI1LnVzIiwic3RhdHVzIjoiMSIsImlhdCI6MTc4NDg4NjE4NCwiZXhwIjoxODE2NDQzNzg0fQ.Oq1Pb_YMUxwiiB605LOiKHSKfI3-KTGY39cWiZ_FyWs"

const ws = new WebSocket(
  `wss://6npwtivqw2.execute-api.us-east-1.amazonaws.com/dev?token=${encodeURIComponent(token)}&fb_user_id=100067189421485`
);

const ws1 = new WebSocket(
  `wss://6npwtivqw2.execute-api.us-east-1.amazonaws.com/dev?token=${encodeURIComponent(token2)}&fb_user_id=100000537972983`
); 
 
ws.on("open", () => {
  console.log("Connected"); 
});

ws1.on("open", () => {
  console.log("Connected");
});

ws.on("message", (data) => {
  console.log(JSON.parse(data.toString()));
});
 
ws1.on("message", (data) => {
  console.log(JSON.parse(data.toString()));
});

ws.on("close", (code, reason) => { 
  console.log("Closed", code, reason.toString());
});
   
ws.on("error", (err) => {
  console.error(err);
});

ws.on("unexpected-response", (req, res) => {
  console.log("Status:", res.statusCode);
}); 