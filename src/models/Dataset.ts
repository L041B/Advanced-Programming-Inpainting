import { DataTypes, Model, Sequelize } from "sequelize";
import { DbConnection } from "../config/database";

export class Dataset extends Model {
  public id!: string; // New UUID primary key
  public userId!: string | null; // Can be null when user is deleted
  public name!: string;
  public data!: object | null;
  public tags!: string[];
  public isDeleted!: boolean;
  public nextUploadIndex!: number;
  
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;

  static initialize() {
    const sequelize: Sequelize = DbConnection.getSequelizeInstance();

    Dataset.init(
      {
        id: {
          type: DataTypes.UUID,
          primaryKey: true,
          defaultValue: DataTypes.UUIDV4, // Auto-generate UUID
        },
        userId: {
          type: DataTypes.UUID,
          allowNull: true, // Changed to allow NULL when user is deleted
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
        // Remove the unique index from here since we're using a partial index in SQL
      }
    );
  }

  static associate() {
    // Associations will be set up in the index file
  }
}

Dataset.initialize();
    // Associations will be set up in the index file