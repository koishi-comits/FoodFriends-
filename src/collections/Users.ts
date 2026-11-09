import type { Access, CollectionConfig } from 'payload'

const isAppUser: Access = ({ req }) => req.user?.collection === 'users'

const isSelf: Access = ({ req }) => {
  if (req.user?.collection !== 'users') return false
  return { id: { equals: req.user.id } }
}

export const Users: CollectionConfig = {
  slug: 'users',
  admin: {
    hidden: true,
    useAsTitle: 'displayName',
  },
  auth: true,
  access: {
    create: () => true,
    delete: () => false,
    read: isSelf,
    update: isSelf,
  },
  fields: [
    {
      name: 'displayName',
      type: 'text',
      required: true,
      maxLength: 40,
    },
    {
      name: 'ageGroup',
      type: 'select',
      defaultValue: '7-9',
      options: ['4-6', '7-9', '10-12'],
    },
    {
      name: 'points',
      type: 'number',
      defaultValue: 120,
      min: 0,
      access: {
        create: () => false,
        update: () => false,
      },
    },
    {
      name: 'streak',
      type: 'number',
      defaultValue: 3,
      min: 0,
      access: {
        create: () => false,
        update: () => false,
      },
    },
  ],
  versions: false,
}
