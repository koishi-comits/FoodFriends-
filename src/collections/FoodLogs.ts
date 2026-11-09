import type { Access, CollectionConfig } from 'payload'

const isAppUser: Access = ({ req }) => req.user?.collection === 'users'

const isOwner: Access = ({ req }) => {
  if (req.user?.collection !== 'users') return false
  return { owner: { equals: req.user.id } }
}

export const FoodLogs: CollectionConfig = {
  slug: 'food-logs',
  admin: {
    group: 'FoodFreinds',
    useAsTitle: 'foodName',
  },
  access: {
    create: isAppUser,
    delete: isOwner,
    read: isOwner,
    update: isOwner,
  },
  hooks: {
    beforeValidate: [
      ({ data, operation, req }) => {
        if (operation === 'create' && req.user?.collection === 'users') {
          return { ...data, owner: req.user.id }
        }
        return data
      },
    ],
  },
  fields: [
    {
      name: 'owner',
      type: 'relationship',
      relationTo: 'users',
      required: true,
      index: true,
      admin: { readOnly: true },
    },
    {
      name: 'foodName',
      type: 'text',
      required: true,
      maxLength: 80,
    },
    {
      name: 'foodGroup',
      type: 'select',
      required: true,
      options: ['fruit', 'vegetable', 'protein', 'grain', 'dairy', 'treat'],
    },
    {
      name: 'score',
      type: 'number',
      required: true,
      min: 1,
      max: 100,
    },
    {
      name: 'summary',
      type: 'text',
      required: true,
      maxLength: 180,
    },
  ],
  timestamps: true,
  versions: false,
}
