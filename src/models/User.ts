// Import necessary modules from Sequelize and other models.
import { DataTypes, Model, Sequelize } from "sequelize";
import { DbConnection } from "../config/database";

// User model representing a user in the system.
export class User extends Model {
  public id!: string;
  public name!: string;
  public surname!: string;
  public email!: string;
  public password!: string;
  public tokens!: number; // Token balance
  public role!: "user" | "admin"; // User role

  // Timestamps are managed automatically by Sequelize.
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;

  // Initializes the User model, defining its schema and configuration with Sequelize.
  static initialize() {
    const sequelize: Sequelize = DbConnection.getSequelizeInstance();

    // Initialize the User model with its attributes and options.
    User.init(
      {
        id: {
          type: DataTypes.UUID,
          primaryKey: true,
          defaultValue: DataTypes.UUIDV4, // Automatically generates a v4 UUID for new users.
        },
        name: {
          type: DataTypes.STRING(100),
          allowNull: false,
        },
        surname: {
          type: DataTypes.STRING(100),
          allowNull: false,
        },
        email: {
          type: DataTypes.STRING(255),
          allowNull: false,
          unique: true, 
          validate: {
            isEmail: true,
          },
        },
        password: {
          type: DataTypes.STRING(255),
          allowNull: false, 
        },
        tokens: {
          type: DataTypes.DECIMAL(10, 2),
          allowNull: false,
          defaultValue: 100.00,
          validate: {
            min: 0
          }
        },
        role: {
          type: DataTypes.ENUM("user", "admin"),
          allowNull: false,
          defaultValue: "user"
        }
      },
      {
        sequelize,
        modelName: "User",
        tableName: "users",
        timestamps: true, 
        underscored: true,
      }
    );
  }

  // Defines the associations for the User model.
  static associate() {
    // Associations will be set up in the index file
  }
}