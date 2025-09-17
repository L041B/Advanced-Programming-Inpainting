import { User } from "./User";
import { Dataset } from "./Dataset";
import { Inference } from "./Inference";
import { Execution } from "./Execution";

// Initialize all models
export function initializeModels(): void {
  // Models are already initialized in their respective files
  // Set up associations
  User.associate();
  Dataset.associate();
  Inference.associate();
  
  // Add Dataset and Inference associations to User
  User.hasMany(Dataset, { foreignKey: "userId", as: "datasets" });
  User.hasMany(Inference, { foreignKey: "userId", as: "inferences" });
}

export { User, Dataset, Inference, Execution };
