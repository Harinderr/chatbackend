require("dotenv").config();
const express = require("express");
const bodyparser = require("body-parser");
const mongoose = require("mongoose");
const ws = require("ws");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const cookieparser = require("cookie-parser");
const bcrypt = require("bcryptjs");
const bcryptSalt = bcrypt.genSaltSync(10);
const Message = require('./messageSchema')
const app = express();
const PORT = process.env.PORT || 3000
app.use(
  cors({
    credentials: true,
    origin: process.env.CLIENT_URL,
  })
);
app.use(bodyparser.urlencoded({ extended: false }));
app.use(express.json());
app.use(cookieparser());

async function connectToDB() {
  try {
    mongoose.connect(process.env.MONGO_PASS, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log("connected successfully");
  } catch (err) {
    console.log("there was an error");
  }
}
connectToDB();
const jwtSecret = process.env.JWT_SECRET;
const userSchema = new mongoose.Schema(
  {
    username: { type: String, unique: true },
    password: String,
  },
  { timestamps: true }
);

const User = mongoose.model("User", userSchema);
app.get("/profile", (req, res) => {
  const token = req.cookies?.token;
  if (token) {
    jwt.verify(
      token,
      jwtSecret,
      { secure: true, sameSite: "none" },
      (err, userData) => {
        if (err) throw err;
        res.json(userData);
      }
    );
  } else {
    res.status(401).json("no valid token");
  }
});

app.post("/login", async (req, res) => {
  const { username, password } = req.body;
  try {
    const foundUser = await User.findOne({ username });
    if (foundUser) {
      const passCheck = bcrypt.compareSync(password, foundUser.password);
      if (passCheck) {
        jwt.sign(
          { userid: foundUser._id, username },
          jwtSecret,
          {},
          (err, token) => {
            res
              .cookie("token", token, { secure: true, sameSite: "none" })
              .status(201)
              .json({
                id: foundUser._id,
              });
          }
        );
      }
    } else {
      res.json("no user found");
    }
  } catch (err) {
    throw err;
  }
});

function getUserDataFromRequest(req){
  return new Promise((resolve,reject)=> {
    const token = req.cookies?.token
   
      if(token){
          jwt.verify(token, jwtSecret, {}, (err,userData)=> {
              if(err) throw err
             resolve(userData)
            
          })
      } else {
        reject('no user token')
      }
     }
  )  }

  
app.get('/messages/:userId',  async (req,res) =>{
  const {userId} = req.params
  const userData = await getUserDataFromRequest(req)
  const ourUserId = userData.userid
  
  const chatData  = await  Message.find({
    sender:{$in : [userId,ourUserId]},
    recipient : {$in : [userId, ourUserId]}
    
  }).sort({createdAT:1}).exec()
res.json(chatData)
})


app.post("/register", async function (req, res) {
  const { username, password } = req.body;

  try {
    const hashPass = bcrypt.hashSync(password, bcryptSalt);
    const createdUser = new User({ username: username, password: hashPass });
    await createdUser.save();
    jwt.sign({ userid: createdUser._id,username }, jwtSecret, {}, (err, token) => {
      if (err) {
        console.log(err);
      } else {
        return res
          .cookie("token", token, { secure: true, sameSite: "none" })
          .status(201)
          .json({
            id: createdUser._id,
          });
      }
    });
  } catch (err) {
    console.log(err);
  }
});

const server = app.listen(PORT);

const wss = new ws.WebSocketServer({ server });
wss.on("connection", (connection,req) => {
  const cookies = req.headers.cookie
  if(cookies){
    const tokenCookieString = cookies.split(';').find(str => str.startsWith('token'))
   if(tokenCookieString){
    const token = tokenCookieString.split('=')[1]
    console.log(token);
    if(token){
        jwt.verify(token, jwtSecret, {}, (err,userData)=> {
            if(err) throw err
            const {userid, username} = userData
            connection.userid = userid
            connection.username = username
        })
    }
   }
  }
// notify everyone about online people when someone connects
connection.on('message', (message)=> {
  const parsedmessage = JSON.parse(message)
  const {newMessage: {recipient, text}} = parsedmessage;
  
 
  if(recipient && text){
    const messageDoc = Message.create({sender:connection.userid, recipient, text}).then((err,result)=> {
      if(err) throw err
      console.log('message stored')
    }).catch(err => console.log(err));
    [...wss.clients]
    .filter(val => val.userid === recipient)
    .forEach(c => c.send(JSON.stringify({text,
    sender : connection.userid,
    recipient,
    id: messageDoc._id
    })))
   
  }
});
  
  [...wss.clients].forEach(client => {
  client.send(JSON.stringify({
    online : [...wss.clients].map(c => ({userid : c.userid , username : c.username}))
  }))
  })
});

