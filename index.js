const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

const { query } = require("express");
require("dotenv").config();
const stripe = require("stripe")(process.env.STRIPE_SECRET);
const app = express();
const port = process.env.PORT || 8000;

//middle wares
app.use(cors());
app.use(express.json());

// app.get("/", (req, res) => {
//   res.send("Hello world");
// });

app.get("/", (req, res) => {
  res.json({ result: true });
});

console.log(process.env.DB_USER, process.env.DB_PASSWORD);

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@hero-one.z3ku6ig.mongodb.net/?retryWrites=true&w=majority`;
console.log(uri);
const client = new MongoClient(uri, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  serverApi: ServerApiVersion.v1,
});

function verifyJWT(req, res, next) {
  const authHeader = req.headers.authorization;
  //console.log("authHeader", authHeader);
  if (!authHeader) {
    return res
      .status(401)
      .send({ status: 401, message: "unauthorization access" });
  }

  const token = authHeader.split(" ")[1];

  jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, function (err, decoded) {
    if (err) {
      return res
        .status(401)
        .send({ status: 401, message: "unauthorization access" });
    }
    req.decoded = decoded;
    next();
  });
}

async function run() {
  try {
    const appointmentOptionCollection = client
      .db("doctors")
      .collection("appointmentOptions");

    const bookingCollection = client.db("doctors").collection("bookings");
    const usersCollection = client.db("doctors").collection("users");
    const doctorsCollection = client.db("doctors").collection("doctors");
    const paymentsCollection = client.db("doctors").collection("payments");

    // app.post("/jwt", (req, res) => {
    //   const user = req.body;
    //   var token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, {
    //     expiresIn: "1h",
    //   });
    //   res.send({ token });
    // });

    const verifyAdmin = async (req, res, next) => {
      const decodedEmail = req.decoded.email;
      const query = { email: decodedEmail };
      const user = await usersCollection.findOne(query);
      if (user?.role !== "admin") {
        return res.status(403).send({ message: "forbidden access" });
      }
      next();
    };

    app.get("/jwt", async (req, res) => {
      const email = req.query.email;
      const query = { email: email };
      const user = await usersCollection.findOne(query);
      if (user) {
        var token = jwt.sign({ email }, process.env.ACCESS_TOKEN_SECRET, {
          expiresIn: "1h",
        });
        console.log(token);
        return res.send({ accessToken: token });
      }

      res.status(403).send({ accessToken: "" });
    });

    // Get Appointment Options
    app.get("/appointmentOptions", async (req, res) => {
      const date = req.query.date;
      const query = {};
      const options = await appointmentOptionCollection.find(query).toArray();

      // get the bookings of the provided date
      const bookingQuery = { appointmentDate: date };
      const alreadyBooked = await bookingCollection
        .find(bookingQuery)
        .toArray();

      // code carefully :D
      options.forEach((option) => {
        const optionBooked = alreadyBooked.filter(
          (book) => book.treatment === option.name
        );
        const bookedSlots = optionBooked.map((book) => book.slot);
        const remainingSlots = option.slots.filter(
          (slot) => !bookedSlots.includes(slot)
        );
        option.slots = remainingSlots;
      });
      res.send(options);
    });

    // New version

    app.get("/v2/appointmentOptions", async (req, res) => {
      const date = req.query.date;
      const options = await appointmentOptionCollection
        .aggregate([
          {
            $lookup: {
              from: "bookings",
              localField: "name",
              foreignField: "treatment",
              pipeline: [
                {
                  $match: {
                    $expr: {
                      $eq: ["$appointmentDate", date],
                    },
                  },
                },
              ],
              as: "booked",
            },
          },
          {
            $project: {
              name: 1,
              slots: 1,
              price: 1,
              booked: {
                $map: {
                  input: "$booked",
                  as: "book",
                  in: "$$book.slot",
                },
              },
            },
          },
          {
            $project: {
              name: 1,
              price: 1,
              slots: {
                $setDifference: ["$slots", "$booked"],
              },
            },
          },
        ])
        .toArray();
      res.send(options);
    });

    /***
     * bookings
     * app.get('/bookings')
     * app.get('/bookings/:id')
     * app.post('/bookings')
     * app.patch('/bookings/:id')
     * app.delete('/bookings/:id')
     * */
    app.get("/appointmentSpeciality", async (req, res) => {
      const query = {};
      const result = await appointmentOptionCollection
        .find(query)
        .project({ name: 1 })
        .toArray();
      res.send(result);
    });

    app.get("/bookings", verifyJWT, async (req, res) => {
      const email = req.query.email;
      const decodedEmail = req.decoded.email;
      if (email != decodedEmail) {
        return res.status(403).send({ message: "forbidden access" });
      }
      //console.log("token", req.headers.authorization);
      const query = { email: email };
      const bookings = await bookingCollection.find(query).toArray();
      res.send(bookings);
    });

    app.get("/bookings/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: ObjectId(id) };
      const booking = await bookingCollection.findOne(query);
      res.send(booking);
    });

    app.post("/bookings", async (req, res) => {
      const booking = req.body;
      console.log(booking);
      const query = {
        appointmentDate: booking.appointmentDate,
        email: booking.email,
        treatment: booking.treatment,
      };

      const alreadyBooked = await bookingCollection.find(query).toArray();

      if (alreadyBooked.length) {
        const message = `You already have a booking on ${booking.appointmentDate}`;
        return res.send({ acknowledged: false, message });
      }

      const result = await bookingCollection.insertOne(booking);
      res.send(result);
    });

    app.get("/users", async (req, res) => {
      const query = {};
      const resut = await usersCollection.find(query).toArray();
      res.send(resut);
    });

    app.get("/users/admin/:email", async (req, res) => {
      const email = req.params.email;
      const query = { email: email };
      const user = await usersCollection.findOne(query);
      res.send({ isAdmin: user?.role === "admin" });
    });

    app.post("/users", async (req, res) => {
      const user = req.body;
      const resut = await usersCollection.insertOne(user);
      res.send(resut);
    });

    app.put("/users/admin/:id", verifyJWT, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const filter = { _id: ObjectId(id) };
      const option = {
        upsert: true,
      };
      const updatedDoc = {
        $set: {
          role: "admin",
        },
      };

      const result = await usersCollection.updateOne(
        filter,
        updatedDoc,
        option
      );
      res.send(result);
    });

    //temporary to udate price field on appoinment options

    app.get("/addPrice", async (req, res) => {
      const filter = {};
      const options = { upsert: true };
      const updateDoc = {
        $set: {
          price: 99,
        },
      };
      const result = await appointmentOptionCollection.updateMany(
        filter,
        updateDoc,
        options
      );
      res.send(result);
    });

    // add doctor
    app.post("/doctors", verifyJWT, verifyAdmin, async (req, res) => {
      const doctors = req.body;
      const result = await doctorsCollection.insertOne(doctors);
      res.send(result);
    });

    // get doctor
    app.get("/doctors", verifyJWT, async (req, res) => {
      const query = {};
      const result = await doctorsCollection.find(query).toArray();
      res.send(result);
    });

    // delete doctor
    app.delete("/doctors", verifyJWT, verifyAdmin, async (req, res) => {
      const id = req.query.id;
      const query = { _id: ObjectId(id) };
      const result = await doctorsCollection.deleteOne(query);
      res.send(result);
    });

    //Payment

    app.post("/create-payment-intent", async (req, res) => {
      const bookings = req.body;
      const { appointmentDate, treatment, patient, slot, email, phone, price } =
        bookings;

      const amount = price * 100;

      // Create a PaymentIntent with the order amount and currency
      const paymentIntent = await stripe.paymentIntents.create({
        amount: amount,
        currency: "usd",
        automatic_payment_methods: {
          enabled: true,
        },
      });

      res.send({
        clientSecret: paymentIntent.client_secret,
      });
    });

    app.post("/payments", async (req, res) => {
      const payment = req.body;
      const result = await paymentsCollection.insertOne(payment);
      const id = payment.bookingId;
      const filter = { _id: ObjectId(id) };
      const updatedDoc = {
        $set: {
          paid: true,
          transactionId: payment.transactionId,
        },
      };
      const updateResult = await bookingCollection.updateOne(
        filter,
        updatedDoc
      );
      res.send(result);
    });

    //
  } finally {
    //await client.close();
  }
}

run().catch((err) => console.log(error));

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});
