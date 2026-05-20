import mongoose from "mongoose"

const logSchema = new mongoose.Schema({

    user: String,

    action: String,

    orderId: String,

    createdAt: {
        type: Date,
        default: Date.now
    }

})

const Log = mongoose.model("Log", logSchema)

export default Log