import { z } from 'zod';

// ─── Enums (matching Prisma) ─────────────────────────────

export const NationalityTypeEnum = z.enum(['THAI', 'NON_THAI']);
export const ParticipantTypeEnum = z.enum(['STUDENT', 'TEACHER', 'STAFF', 'GENERAL_PUBLIC', 'GUEST']);

// ─── Registration Form Schema ────────────────────────────

export const registrationSchema = z.object({
  // Hidden fields (จาก LIFF)
  lineUserId: z.string().min(1, 'lineUserId is required'),
  displayName: z.string().optional(),

  // Basic Information
  nationalityType: NationalityTypeEnum,
  firstName: z.string().min(1, 'First name is required').max(100),
  lastName: z.string().min(1, 'Last name is required').max(100),
  nickname: z.string().min(1, 'Nickname is required').max(50),
  dateOfBirth: z.string().refine(
    (val) => !isNaN(Date.parse(val)),
    { message: 'Invalid date format' }
  ),
  email: z.string().email('Invalid email format'),
  phoneNumber: z.string()
    .min(9, 'Phone number too short')
    .max(15, 'Phone number too long')
    .regex(/^[+]?[0-9\s-]+$/, 'Invalid phone number format'),
  country: z.string().optional(),

  // Participant Information
  participantType: ParticipantTypeEnum,
  organization: z.string().min(1, 'Organization is required').max(200),
  faculty: z.string().optional(),
  facultyOther: z.string().optional(),
  department: z.string().optional(),
  departmentOther: z.string().optional(),

  // Consent
  pdpaConsent: z.literal(true, {
    errorMap: () => ({ message: 'PDPA consent is required' })
  }),
  mediaConsent: z.literal(true, {
    errorMap: () => ({ message: 'Media consent is required' })
  }),

  // Activity Sessions (optional — participant can register without booking any activity)
  selectedSessionIds: z.array(z.string().uuid()).default([])

}).superRefine((data, ctx) => {
  // Conditional: country required if NON_THAI
  if (data.nationalityType === 'NON_THAI' && (!data.country || data.country.trim() === '')) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Country is required for non-Thai participants',
      path: ['country']
    });
  }

  // Conditional: faculty required if STUDENT
  if (data.participantType === 'STUDENT') {
    if (!data.faculty || data.faculty.trim() === '') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Faculty is required for students',
        path: ['faculty']
      });
    }
    if (!data.department || data.department.trim() === '') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Department is required for students',
        path: ['department']
      });
    }
  }

  // Conditional: facultyOther required if faculty = "OTHER"
  if (data.faculty === 'OTHER' && (!data.facultyOther || data.facultyOther.trim() === '')) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Please specify your faculty',
      path: ['facultyOther']
    });
  }

  // Conditional: departmentOther required if department = "OTHER"
  if (data.department === 'OTHER' && (!data.departmentOther || data.departmentOther.trim() === '')) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Please specify your department',
      path: ['departmentOther']
    });
  }
});

// ─── Update Registration Schema (ไม่ต้องส่ง sessions ซ้ำถ้าไม่แก้) ─

export const updateRegistrationSchema = z.object({
  // Basic Information (all optional for partial update)
  nationalityType: NationalityTypeEnum.optional(),
  firstName: z.string().min(1).max(100).optional(),
  lastName: z.string().min(1).max(100).optional(),
  nickname: z.string().min(1).max(50).optional(),
  dateOfBirth: z.string().refine(
    (val) => !isNaN(Date.parse(val)),
    { message: 'Invalid date format' }
  ).optional(),
  email: z.string().email().optional(),
  phoneNumber: z.string().min(9).max(15).optional(),
  country: z.string().optional(),

  // Participant Information
  participantType: ParticipantTypeEnum.optional(),
  organization: z.string().min(1).max(200).optional(),
  faculty: z.string().optional(),
  facultyOther: z.string().optional(),
  department: z.string().optional(),
  departmentOther: z.string().optional(),

  // Consent
  pdpaConsent: z.literal(true).optional(),
  mediaConsent: z.literal(true).optional(),

  // Sessions (ถ้าส่งมา = replace ทั้งหมด)
  selectedSessionIds: z.array(z.string().uuid()).optional()
});

// ─── Types ───────────────────────────────────────────────

export type RegistrationInput = z.infer<typeof registrationSchema>;
export type UpdateRegistrationInput = z.infer<typeof updateRegistrationSchema>;
