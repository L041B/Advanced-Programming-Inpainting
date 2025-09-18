// Import necessary modules from Sequelize and other parts of the application.
import { DataTypes, Model, Sequelize } from "sequelize";
import { DbConnection } from "../config/database";

// Execution model representing an inpainting job.
export class Execution extends Model {
  public id!: string; 
  public userId!: string;
  public originalImage!: Buffer;
  public maskImage!: Buffer;
  public outputImage!: Buffer | null;
  public status!: "pending" | "processing" | "completed" | "failed"; 
  
  // Timestamps managed by Sequelize.
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;

  // Initializes the Execution model, defining its schema and configuration.
  static initialize() {
    const sequelize: Sequelize = DbConnection.getSequelizeInstance();

    Execution.init(
      {
        id: {
          type: DataTypes.UUID,
          primaryKey: true,
          defaultValue: DataTypes.UUIDV4, // Automatically generate UUID v4 for new records.
        },
        userId: {
          type: DataTypes.UUID,
          allowNull: false,
          field: "user_id",
        },
        
        originalImage: {
          type: DataTypes.BLOB,
          allowNull: false,
          field: "original_image",
        },
        maskImage: {
          type: DataTypes.BLOB,
          allowNull: false,
          field: "mask_image",
        },
        outputImage: {
          type: DataTypes.BLOB,
          allowNull: true,
          field: "output_image",
        },
        status: {
          type: DataTypes.ENUM("pending", "processing", "completed", "failed"),
          allowNull: false,
          defaultValue: "pending",
        },
      },
      {
        sequelize,
        modelName: "Execution",
        tableName: "executions",
        timestamps: true, 
        underscored: true,
      }
    );
  }

  // Defines the associations for the Execution model.
  static associate() {
    // Associations will be set up in the index file
  }
}

// Initialize the model to register it with Sequelize.
Execution.initialize();