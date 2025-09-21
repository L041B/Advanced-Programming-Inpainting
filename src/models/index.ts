// Import all model classes
import { User } from "./User";
import { Dataset } from "./Dataset";
import { Inference } from "./Inference";
import { TokenTransaction } from "./TokenTransaction";

// Initialize all models
User.initialize();
TokenTransaction.initialize();
Dataset.initialize();
Inference.initialize();

// Set up model associations
// One-to-many relationship between User and Dataset
User.hasMany(Dataset, {
    foreignKey: "userId",
    as: "datasets"
});

// One-to-many relationship between User and Inference
User.hasMany(Inference, {
    foreignKey: "userId",
    as: "inferences"
});

// One-to-many relationship between User and TokenTransaction
User.hasMany(TokenTransaction, {
    foreignKey: "userId",
    as: "tokenTransactions"
});


// One-to-many relationship between Dataset and User
Dataset.belongsTo(User, {
    foreignKey: "userId",
    as: "user"
});

// One-to-many relationship between Dataset and Inference
Dataset.hasMany(Inference, {
    foreignKey: "datasetId", 
    as: "inferences"
});

// One-to-many relationship between Inference and User
Inference.belongsTo(User, {
    foreignKey: "userId",
    as: "user"
});

// One-to-many relationship between Inference and Dataset   
Inference.belongsTo(Dataset, {
    foreignKey: "datasetId", 
    as: "dataset"
});

// One-to-many relationship between TokenTransaction and User
TokenTransaction.belongsTo(User, { 
    foreignKey: "userId", 
    as: "user" 
});

// Export all models
export {
    User,
    Dataset,
    Inference,
    TokenTransaction
};

