// Import all model classes
import { User } from "./User";
import { Execution } from "./Execution";
import { Dataset } from "./Dataset";
import { Inference } from "./Inference";
import { TokenTransaction } from "./TokenTransaction";

// Step 1: Initialize all models (schema definition)
User.initialize();
TokenTransaction.initialize();
Dataset.initialize();
Inference.initialize();
Execution.initialize();

// Step 2: Set up all associations after models are initialized
// User associations
User.hasMany(Execution, { 
    foreignKey: "userId", 
    as: "executions"
});

User.hasMany(Dataset, {
    foreignKey: "userId",
    as: "datasets"
});

User.hasMany(Inference, {
    foreignKey: "userId",
    as: "inferences"
});

User.hasMany(TokenTransaction, {
    foreignKey: "userId",
    as: "tokenTransactions"
});

// Execution associations
Execution.belongsTo(User, { 
    foreignKey: "userId", 
    as: "user"
});

// Dataset associations
Dataset.belongsTo(User, {
    foreignKey: "userId",
    as: "user"
});

Dataset.hasMany(Inference, {
    foreignKey: "datasetId", // Changed from datasetName to datasetId
    as: "inferences"
});

// Inference associations
Inference.belongsTo(User, {
    foreignKey: "userId",
    as: "user"
});

Inference.belongsTo(Dataset, {
    foreignKey: "datasetId", // Changed from datasetName to datasetId
    as: "dataset"
});

// TokenTransaction associations
TokenTransaction.belongsTo(User, { 
    foreignKey: "userId", 
    as: "user" 
});

export {
    User,
    Execution,
    Dataset,
    Inference,
    TokenTransaction
};

