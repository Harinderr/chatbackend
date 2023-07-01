require("dotenv").config();
const express = require("express");
const bodyparser = require('body-parser')
const mongoose = require("mongoose");
const ws = require("ws");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const cookieparser = require("cookie-parser");
const bcrypt = require("bcryptjs");
const bcryptSalt = bcrypt.genSaltSync(10);
const Message = require("./messageSchema");
const app = express();
const fs = require("fs");
const PORT = process.env.PORT || 3000;

app.use(
  cors({
    credentials: true,
    origin: process.env.CLIENT_URL,
  })
);
app.use("/uploads", express.static(__dirname + "/uploads"));
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
    username: { type: String, unique: true, required: true },
    password: { type: String, required: true },
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
    res.status(401).json("no valid here token");
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

function getUserDataFromRequest(req) {
  return new Promise((resolve, reject) => {
    const token = req.cookies?.token;

    if (token) {
      jwt.verify(token, jwtSecret, {}, (err, userData) => {
        if (err) throw err;
        resolve(userData);
      });
    } else {
      reject("no user token");
    }
  });
}

app.get("/messages/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const userData = await getUserDataFromRequest(req);
    const ourUserId = userData.userid;

    const chatData = await Message.find({
      sender: { $in: [userId, ourUserId] },
      recipient: { $in: [userId, ourUserId] },
    })
      .sort({ createdAT: 1 })
      .exec();
    res.json(chatData);
  } catch (err) {
    console.log("not able to recieve messages");
  }
});

app.post("/register", async function (req, res) {
  const { username, password } = req.body;

  try {
    const hashPass = bcrypt.hashSync(password, bcryptSalt);
    const createdUser = new User({ username: username, password: hashPass });
    await createdUser.save();
    jwt.sign(
      { userid: createdUser._id, username },
      jwtSecret,
      {},
      (err, token) => {
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
      }
    );
  } catch (err) {
    console.log(err);
  }
});

app.post("/logout", (req, res) => {
  res.cookie("token", "", { secure: true, sameSite: "none" }).json("ok");
});

app.get("/people", (req, res) => {
  User.find({})
    .exec()
    .then((allUsers) => {
      const newlist = allUsers.map((val) => {
        const { _id, username } = val;
        return { _id, username };
      });
      res.json(newlist);
    })
    .catch((error) => {
      console.error(error);
      res.status(500).json({ error: "Internal Server Error" });
    });
});

const server = app.listen(PORT);

const wss = new ws.WebSocketServer({ server });
wss.on("connection", (connection, req) => {
  function UpdatedOnlinePeople() {
    [...wss.clients].forEach((client) => {
      client.send(
        JSON.stringify({
          online: [...wss.clients].map((c) => ({
            userid: c.userid,
            username: c.username,
          })),
        })
      );
    });
  }
  connection.isAlive = true;
  connection.timer = setInterval(() => {
    connection.ping();
    connection.deathTimer = setTimeout(() => {
      connection.isAlive = false;
      clearInterval(connection.timer);
      connection.terminate();
      UpdatedOnlinePeople();
      console.log("dead");
    }, 1000);
  }, 10000);

  connection.on("pong", () => {
    clearTimeout(connection.deathTimer);
  });
  const cookies = req.headers.cookie;
  if (cookies) {
    const tokenCookieString = cookies
      .split(";")
      .find((str) => str.startsWith("token"));
    if (tokenCookieString) {
      const token = tokenCookieString.split("=")[1];

      if (token) {
        jwt.verify(token, jwtSecret, {}, (err, userData) => {
          if (err) throw err;
          const { userid, username } = userData;
          connection.userid = userid;
          connection.username = username;
        });
      }
    }
  }
  // notify everyone about online people when someone connects
  connection.on("message", async (message) => {
    const parsedmessage = JSON.parse(message);
    const {
      newMessage: { recipient, text, file },
    } = parsedmessage;
    let filename = null;
    if (file) {
      const parts = file.info.split(".");
      const ext = parts[parts.length - 1];
      filename = Date.now() + "." + ext;
      const path = __dirname + "/uploads/" + filename;
      const bufferData = Buffer.from(file.data.split(",")[1], "base64");
      fs.writeFile(path, bufferData, () => {
        console.log("file saved " + path);
      });
    }

    if (recipient && (text || file)) {
      const messageDoc = await Message.create({
        sender: connection.userid,
        recipient,
        text,
        file: file ? filename : null
      });
       

  [...wss.clients]
  .filter((val) => val.userid === recipient)
  .forEach((c) =>
    c.send(
      JSON.stringify({
        _id: messageDoc._id,
        text,
        sender: connection.userid,
        recipient,
      file : file ? filename : null
        
      })
    )
  );
 
         
        
      
       
  
    }
  });
  UpdatedOnlinePeople();
});

wss.on("close", (data) => {
  console.log("disconnected", data);
});
