// Import necessary modules from Sequelize and database configuration.
import { DataTypes, Model, Sequelize } from "sequelize";
import { DbConnection } from "../config/database";

// Inference model representing an inference task in the system.
export class Inference extends Model {
  public id!: string;
  public status!: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED" | "ABORTED";
  public modelId!: string;
  public parameters!: Record<string, unknown> | null;
  public result!: Record<string, unknown> | null;
  public datasetId!: string; // Riportiamo a datasetId
  public userId!: string;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;

  // Initializes the Inference model, defining its schema and configuration with Sequelize.
  static initialize() {
    const sequelize: Sequelize = DbConnection.getSequelizeInstance();

    // Initialize the Inference model with its attributes and options.
    Inference.init(
      {
        id: {
          type: DataTypes.UUID,
          defaultValue: DataTypes.UUIDV4,
          primaryKey: true,
        },
        status: {
          type: DataTypes.ENUM("PENDING", "RUNNING", "COMPLETED", "FAILED", "ABORTED"),
          allowNull: false,
          defaultValue: "PENDING"
        },
        modelId: {
          type: DataTypes.STRING(255),
          allowNull: false,
          field: "model_id"
        },
        parameters: {
          type: DataTypes.JSONB,
          allowNull: true
        },
        result: {
          type: DataTypes.JSONB,
          allowNull: true
        },
        datasetId: {
          type: DataTypes.UUID,
          allowNull: false,
          field: "dataset_id" // Torna a dataset_id
        },
        userId: {
          type: DataTypes.UUID,
          allowNull: false,
          field: "user_id"
        }
      },
      {
        sequelize,
        modelName: "Inference",
        tableName: "inferences",
        timestamps: true,
        underscored: true,
      }
    );
  }

  static associate() {
    // Associations will be set up in the index file
  }
}

// Initialize the Inference model
Inference.initialize();


