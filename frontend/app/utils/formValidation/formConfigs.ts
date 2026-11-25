import { FormConfig } from './types';
import { createZodFieldValidator } from './zodValidation';
import { taskCreationSchema, taskFormSchema, EXAMPLE_CONTRACT_ADDRESS } from './schemas/taskCreationSchema';
import { required } from './validators';

// Task Creation Form Configuration (Zod-backed)
export const taskCreationFormConfig: FormConfig = {
  fields: {
    contractAddress: {
      name: 'contractAddress',
      initialValue: '',
      validation: [createZodFieldValidator(taskCreationSchema, 'contractAddress')],
      asyncValidation: async (address: string) => {
        // Mock async validation - in real app, verify contract exists
        await new Promise(resolve => setTimeout(resolve, 800));
        const validContracts = [EXAMPLE_CONTRACT_ADDRESS, 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'];
        return {
          isValid: validContracts.includes(address),
          message: validContracts.includes(address) ? undefined : 'Contract not found or invalid'
        };
      },
      debounceMs: 500,
      required: true,
      placeholder: 'C...',
      type: 'text'
    },
    functionName: {
      name: 'functionName',
      initialValue: '',
      validation: [createZodFieldValidator(taskCreationSchema, 'functionName')],
      required: true,
      placeholder: 'harvest_yield',
      type: 'text'
    },
    interval: {
      name: 'interval',
      initialValue: '',
      validation: [createZodFieldValidator(taskCreationSchema, 'interval')],
      required: true,
      placeholder: '3600',
      type: 'number',
      min: 60
    },
    gasBalance: {
      name: 'gasBalance',
      initialValue: '',
      validation: [createZodFieldValidator(taskCreationSchema, 'gasBalance')],
      required: true,
      placeholder: '10',
      type: 'number',
      min: 0.1,
      max: 10000,
      step: '0.1'
    },
    dueDate: {
      name: 'dueDate',
      initialValue: '',
      validation: [], // Handled by DateInput component
      required: false,
      type: 'text'
    }
  },
  validateOnChange: true,
  validateOnBlur: true,
  focusFirstError: true,
  resetOnSubmit: false,
  onSubmit: async (values) => {
    console.log('Submitting task:', values);
    // Mock API call
    await new Promise(resolve => setTimeout(resolve, 1500));
    
    // Simulate potential errors
    if (values.contractAddress === 'CINVALID') {
      throw new Error('Invalid contract address');
    }
  }
};

// Simpler TaskForm configuration (Zod-backed, used by TaskForm component)
export const taskFormConfig: FormConfig = {
  fields: {
    targetAddress: {
      name: 'targetAddress',
      initialValue: '',
      validation: [createZodFieldValidator(taskFormSchema, 'targetAddress')],
      required: true,
      placeholder: 'C...',
      type: 'text',
    },
    functionName: {
      name: 'functionName',
      initialValue: '',
      validation: [createZodFieldValidator(taskFormSchema, 'functionName')],
      required: true,
      placeholder: 'harvest_yield',
      type: 'text',
    },
    intervalSeconds: {
      name: 'intervalSeconds',
      initialValue: 3600,
      validation: [createZodFieldValidator(taskFormSchema, 'intervalSeconds')],
      required: true,
      placeholder: '3600',
      type: 'number',
      min: 60,
    },
    gasBalance: {
      name: 'gasBalance',
      initialValue: 10,
      validation: [createZodFieldValidator(taskFormSchema, 'gasBalance')],
      required: true,
      placeholder: '10',
      type: 'number',
      min: 0.1,
      max: 10000,
      step: '0.1',
    },
  },
  validateOnChange: true,
  validateOnBlur: true,
  focusFirstError: true,
  resetOnSubmit: false,
};

// User Settings Form Configuration
export const userSettingsFormConfig: FormConfig = {
  fields: {
    username: {
      name: 'username',
      initialValue: '',
      validation: [
        required('Username is required'),
        { validate: (value: string) => ({
          isValid: /^[a-zA-Z0-9_]{3,20}$/.test(value),
          message: 'Username must be 3-20 characters, letters, numbers, and underscores only'
        })}
      ],
      required: true,
      placeholder: 'johndoe',
      type: 'text'
    },
    email: {
      name: 'email',
      initialValue: '',
      validation: [
        required('Email is required'),
        { validate: (value: string) => {
          const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
          return { isValid: emailRegex.test(value), message: 'Please enter a valid email address' };
        }}
      ],
      asyncValidation: async (email: string) => {
        await new Promise(resolve => setTimeout(resolve, 600));
        const takenEmails = ['admin@sorotask.com', 'user@sorotask.com'];
        return {
          isValid: !takenEmails.includes(email),
          message: takenEmails.includes(email) ? 'This email is already taken' : undefined
        };
      },
      debounceMs: 400,
      required: true,
      placeholder: 'user@example.com',
      type: 'email'
    },
    bio: {
      name: 'bio',
      initialValue: '',
      validation: [
        { validate: (value: string) => ({
          isValid: value.length <= 500,
          message: 'Bio must be 500 characters or less'
        })}
      ],
      placeholder: 'Tell us about yourself...',
      type: 'textarea',
      rows: 4
    },
    timezone: {
      name: 'timezone',
      initialValue: 'UTC',
      validation: [
        required('Timezone is required')
      ],
      required: true,
      type: 'text'
    }
  },
  validateOnChange: true,
  validateOnBlur: true,
  focusFirstError: true,
  resetOnSubmit: false,
  onSubmit: async (values) => {
    console.log('Updating user settings:', values);
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
};

// Project Settings Form Configuration
export const projectSettingsFormConfig: FormConfig = {
  fields: {
    projectName: {
      name: 'projectName',
      initialValue: '',
      validation: [
        required('Project name is required'),
        { validate: (value: string) => ({
          isValid: value.length >= 2 && value.length <= 50,
          message: 'Project name must be 2-50 characters'
        })}
      ],
      required: true,
      placeholder: 'My Automation Project',
      type: 'text'
    },
    description: {
      name: 'description',
      initialValue: '',
      validation: [
        { validate: (value: string) => ({
          isValid: value.length <= 1000,
          message: 'Description must be 1000 characters or less'
        })}
      ],
      placeholder: 'Describe your project...',
      type: 'textarea',
      rows: 5
    },
    maxTasks: {
      name: 'maxTasks',
      initialValue: '10',
      validation: [
        required('Maximum tasks is required'),
        { validate: (value: number) => ({
          isValid: value >= 1 && value <= 100,
          message: 'Maximum tasks must be between 1 and 100'
        })}
      ],
      required: true,
      placeholder: '10',
      type: 'number',
      min: 1,
      max: 100
    },
    autoApprove: {
      name: 'autoApprove',
      initialValue: false,
      validation: [],
      type: 'checkbox'
    }
  },
  validateOnChange: true,
  validateOnBlur: true,
  focusFirstError: true,
  resetOnSubmit: false,
  onSubmit: async (values) => {
    console.log('Updating project settings:', values);
    await new Promise(resolve => setTimeout(resolve, 800));
  }
};

// Field label mappings for error summaries
export const fieldLabels = {
  contractAddress: 'Contract Address',
  targetAddress: 'Target Contract Address',
  functionName: 'Function Name',
  interval: 'Interval (seconds)',
  intervalSeconds: 'Interval (seconds)',
  gasBalance: 'Gas Balance (XLM)',
  dueDate: 'Due Date',
  username: 'Username',
  email: 'Email Address',
  bio: 'Bio',
  timezone: 'Timezone',
  projectName: 'Project Name',
  description: 'Description',
  maxTasks: 'Maximum Tasks',
  autoApprove: 'Auto Approve Tasks'
};
