// Import necessary modules from Sequelize and other models.
import { DataTypes, Model, Sequelize } from "sequelize";
import { DbConnection } from "../config/database";
import { Execution } from "./Execution"; 

// User model representing a user in the system.
export class User extends Model {
  public id!: string; 
  public name!: string;
  public surname!: string;
  public email!: string;
  public password!: string; 
  
  // Timestamps are managed automatically by Sequelize.
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;

  // Initializes the User model, defining its schema and configuration with Sequelize.
  static initialize() {
    const sequelize: Sequelize = DbConnection.getSequelizeInstance();

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
    // A User can have many Executions. This establishes the one-to-many relationship.
    User.hasMany(Execution, { 
        foreignKey: "userId", 
        as: "executions"      // Alias for accessing the executions of a user.
    });
  }
}

// Initialize the model to register it with Sequelize.
User.initialize();