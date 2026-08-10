import mongoose from "mongoose"

const employeeSchema = new mongoose.Schema({
    name: { type: String, required: true },
    position: String,   // должность — необязательно
    phone: String,       // необязательно

    createdAt: {
        type: Date,
        default: Date.now
    }
})

export default mongoose.model("Employee", employeeSchema)