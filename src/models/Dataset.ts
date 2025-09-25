// Import necessary modules from Sequelize and database configuration.
import { DataTypes, Model, Sequelize } from "sequelize";
import { DbConnection } from "../config/database";

// Dataset model representing a dataset in the system.
export class Dataset extends Model {
  public id!: string; // New UUID primary key
  public userId!: string | null; // Can be null when user is deleted
  public name!: string;
  public data!: object | null;
  public tags!: string[];
  public isDeleted!: boolean;
  public deletedAt!: Date | null; // Timestamp when dataset was deleted
  public nextUploadIndex!: number;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;

  // Initializes the Dataset model, defining its schema and configuration with Sequelize.
  static initialize() {
    const sequelize: Sequelize = DbConnection.getSequelizeInstance();

    // Initialize the Dataset model with its attributes and options.
    Dataset.init(
      {
        id: {
          type: DataTypes.UUID,
          primaryKey: true,
          defaultValue: DataTypes.UUIDV4, // Auto-generate UUID
        },
        userId: {
          type: DataTypes.UUID,
          allowNull: true, // Allow NULL when user is deleted
          field: "user_id"
        },
        name: {
          type: DataTypes.STRING(255),
          allowNull: false
        },
        data: {
          type: DataTypes.JSONB,
          allowNull: true
        },
        tags: {
          type: DataTypes.ARRAY(DataTypes.TEXT),
          allowNull: false,
          defaultValue: []
        },
        isDeleted: {
          type: DataTypes.BOOLEAN,
          allowNull: false,
          defaultValue: false,
          field: "is_deleted"
        },
        deletedAt: {
          type: DataTypes.DATE,
          allowNull: true,
          defaultValue: null,
          field: "deleted_at"
        },
        nextUploadIndex: {
          type: DataTypes.INTEGER,
          allowNull: false,
          defaultValue: 1,
          field: "next_upload_index"
        }
      },
      {
        sequelize,
        modelName: "Dataset",
        tableName: "datasets",
        timestamps: true,
        underscored: true
      }
    );
  }

  static associate() {
    // Associations will be set up in the index file
  }
}
// Initialize the Dataset model
Dataset.initialize();