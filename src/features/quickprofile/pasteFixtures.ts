// Fictional LinkedIn profile texts in the shapes members actually copy (desktop select-all, mobile web, app share page, Save to PDF).
// Every name, company and number below is invented.
export interface Fixture {
  name: string
  text: string
  full_name: string | null
  headline: string | null
  city: string | null
  country: string | null
  /** [title, company, start_year, end_year, is_current] */
  jobs: [string, string, number | null, number | null, boolean][]
  /** [school, degree, field, start_year, end_year] */
  schools: [string, string | null, string | null, number | null, number | null][]
  skills?: string[]
  grad_year?: number | null
  branch?: string | null
  current?: [string, string] | null
  linkedin_url?: string | null
  about_starts?: string
}

const NAV = `Skip to search
Skip to main content
Close jump menu
0 notifications total
Home
My Network
Jobs
Messaging
Notifications
Me
For Business
Try Premium for ₹0`

export const FIXTURES: Fixture[] = [
  {
    name: 'desktop: single-role companies, duplicated lines, JEC B.E.',
    text: `${NAV}
Asha Verma
Asha Verma
 (She/Her)
 · 2nd
Senior Software Engineer at Infosys | Python | Cloud
Pune, Maharashtra, India
 ·
Contact info
500+ connections
Infosys
Infosys
Jabalpur Engineering College
Jabalpur Engineering College
Connect
Message
More
About
I build data pipelines and mentor junior engineers. I studied at JEC and still miss the canteen.
…see more
Activity
1,234 followers
Experience
Experience
Infosys
Infosys
Senior Software Engineer
Senior Software Engineer
Infosys · Full-time
Infosys · Full-time
Jan 2020 - Present · 5 yrs 10 mos
Jan 2020 - Present · 5 yrs 10 mos
Pune, Maharashtra, India · Hybrid
Pune, Maharashtra, India · Hybrid
Built the billing data platform used by 40 teams.
Skills: Python, SQL
Software Engineer
Software Engineer
Tech Mahindra · Full-time
Tech Mahindra · Full-time
Aug 2016 - Dec 2019 · 3 yrs 5 mos
Aug 2016 - Dec 2019 · 3 yrs 5 mos
Hyderabad, Telangana, India
Education
Education
Jabalpur Engineering College
Jabalpur Engineering College
Bachelor of Engineering - BE, Computer Science
Bachelor of Engineering - BE, Computer Science
2012 - 2016
2012 - 2016
Activities and societies: Coding club
Skills
Skills
Python
Python
Infosys +2 experiences
Infosys +2 experiences
3 endorsements
SQL
SQL
Show all 14 skills
Show all 14 skills`,
    full_name: 'Asha Verma',
    headline: 'Senior Software Engineer at Infosys | Python | Cloud',
    city: 'Pune',
    country: 'India',
    jobs: [
      ['Senior Software Engineer', 'Infosys', 2020, null, true],
      ['Software Engineer', 'Tech Mahindra', 2016, 2019, false],
    ],
    schools: [['Jabalpur Engineering College', 'Bachelor of Engineering - BE', 'Computer Science', 2012, 2016]],
    skills: ['Python', 'SQL'],
    grad_year: 2016,
    branch: 'B.E. in Computer Science & Engineering',
    current: ['Senior Software Engineer', 'Infosys'],
    about_starts: 'I build data pipelines',
  },
  {
    name: 'desktop: company with three roles (grouped)',
    text: `Rajesh Kumar Tiwari
Director - Manufacturing at Tata Motors
Jamshedpur, Jharkhand, India
Contact info
Experience
Tata Motors
Full-time · 18 yrs 2 mos
Director - Manufacturing
Apr 2021 - Present · 4 yrs 8 mos
Jamshedpur, Jharkhand, India
Led the plant transformation programme.
General Manager
Jan 2016 - Mar 2021 · 5 yrs 3 mos
Pune, Maharashtra, India
Deputy Manager
Oct 2007 - Dec 2015 · 8 yrs 3 mos
Pune, Maharashtra, India
Graduate Engineer Trainee
Larsen & Toubro · Full-time
Jul 2006 - Sep 2007 · 1 yr 3 mos
Mumbai, India
Education
Jabalpur Engineering College
B.E., Mechanical Engineering
2002 - 2006`,
    full_name: 'Rajesh Kumar Tiwari',
    headline: 'Director - Manufacturing at Tata Motors',
    city: 'Jamshedpur',
    country: 'India',
    jobs: [
      ['Director - Manufacturing', 'Tata Motors', 2021, null, true],
      ['General Manager', 'Tata Motors', 2016, 2021, false],
      ['Deputy Manager', 'Tata Motors', 2007, 2015, false],
      ['Graduate Engineer Trainee', 'Larsen & Toubro', 2006, 2007, false],
    ],
    schools: [['Jabalpur Engineering College', 'B.E.', 'Mechanical Engineering', 2002, 2006]],
    grad_year: 2006,
    branch: 'B.E. in Mechanical Engineering',
    current: ['Director - Manufacturing', 'Tata Motors'],
  },
  {
    name: 'mobile web: title, company and type, MBA plus B.E., certifications',
    text: `Priya Sharma
Product Manager at Razorpay
Bengaluru, Karnataka, India · Contact info
2,345 followers · 500+ connections
Connect
Message
About
Product manager who started as an electronics engineer.
Experience
Product Manager
Razorpay · Full-time
Jun 2022 – Present · 3 yrs 5 mos
Bengaluru, Karnataka, India · On-site
Associate Product Manager
Razorpay · Full-time
Jul 2020 – May 2022 · 1 yr 11 mos
Bengaluru, Karnataka, India
Business Analyst
Deloitte · Internship
Jan 2020 – Jun 2020 · 6 mos
Education
Indian Institute of Management Ahmedabad
Master of Business Administration - MBA, Marketing
2018 – 2020
Jabalpur Engineering College
Bachelor of Engineering - BE, Electronics and Telecommunications
2013 – 2017
Licenses & certifications
Certified Scrum Product Owner
Scrum Alliance
Issued Mar 2022
Credential ID 12345
Google Analytics Individual Qualification
Google
Issued Jan 2021 · Expires Jan 2023
Skills
Product Management
Agile Methodologies
Show all 9 skills`,
    full_name: 'Priya Sharma',
    headline: 'Product Manager at Razorpay',
    city: 'Bengaluru',
    country: 'India',
    jobs: [
      ['Product Manager', 'Razorpay', 2022, null, true],
      ['Associate Product Manager', 'Razorpay', 2020, 2022, false],
      ['Business Analyst', 'Deloitte', 2020, 2020, false],
    ],
    schools: [
      ['Indian Institute of Management Ahmedabad', 'Master of Business Administration - MBA', 'Marketing', 2018, 2020],
      ['Jabalpur Engineering College', 'Bachelor of Engineering - BE', 'Electronics and Telecommunications', 2013, 2017],
    ],
    skills: ['Product Management', 'Agile Methodologies'],
    grad_year: 2017,
    branch: 'B.E. in Electronics & Telecommunications',
    current: ['Product Manager', 'Razorpay'],
  },
  {
    name: 'student with no jobs yet',
    text: `Aman Gupta
Student at Jabalpur Engineering College
Jabalpur, Madhya Pradesh, India
Contact info
Education
Jabalpur Engineering College
Bachelor of Technology - BTech, Information Technology
2022 - 2026
Skills
C++
Java
Data Structures`,
    full_name: 'Aman Gupta',
    headline: 'Student at Jabalpur Engineering College',
    city: 'Jabalpur',
    country: 'India',
    jobs: [],
    schools: [['Jabalpur Engineering College', 'Bachelor of Technology - BTech', 'Information Technology', 2022, 2026]],
    skills: ['C++', 'Java', 'Data Structures'],
    grad_year: 2026,
    branch: 'B.E. in Information Technology',
    current: null,
  },
  {
    name: 'gap years, self-employed and a freelance role',
    text: `Neha Dubey
Freelance UX Designer
Greater Delhi Area
Contact info
Experience
UX Designer
Self-employed
Mar 2021 - Present · 4 yrs 9 mos
Remote
Product Designer
Zoho · Full-time
Feb 2015 - Aug 2017 · 2 yrs 7 mos
Chennai, Tamil Nadu, India
Education
Jabalpur Engineering College
Bachelor of Engineering - BE, Computer Science
2010 - 2014`,
    full_name: 'Neha Dubey',
    headline: 'Freelance UX Designer',
    city: 'Delhi',
    country: null,
    jobs: [
      ['UX Designer', 'Self-employed', 2021, null, true],
      ['Product Designer', 'Zoho', 2015, 2017, false],
    ],
    schools: [['Jabalpur Engineering College', 'Bachelor of Engineering - BE', 'Computer Science', 2010, 2014]],
    grad_year: 2014,
    current: ['UX Designer', 'Self-employed'],
  },
  {
    name: 'long About, non-English place names, abroad',
    text: `${NAV}
Vikram Singh Rathore
Staff Engineer at Siemens
München, Bayern, Deutschland
Contact info
About
I moved to Germany in 2012 after finishing my engineering in Jabalpur. Since then I have worked on railway signalling software.

I enjoy mentoring graduates from India who want to work in Europe. Reach out if you need advice on the Blue Card process, apartment hunting or interview preparation for German companies.
…see more
Experience
Staff Engineer
Siemens · Full-time
Mar 2019 - Present · 6 yrs 9 mos
München, Bayern, Deutschland
Software Engineer
Bosch · Full-time
Sep 2012 - Feb 2019 · 6 yrs 6 mos
Stuttgart, Baden-Württemberg, Deutschland
Education
Technische Universität München
Master of Science - MS, Computer Science
2010 - 2012
Jabalpur Engineering College
Bachelor of Engineering - BE, Electronics & Telecommunication
2006 - 2010`,
    full_name: 'Vikram Singh Rathore',
    headline: 'Staff Engineer at Siemens',
    city: 'München',
    country: 'Deutschland',
    jobs: [
      ['Staff Engineer', 'Siemens', 2019, null, true],
      ['Software Engineer', 'Bosch', 2012, 2019, false],
    ],
    schools: [
      ['Technische Universität München', 'Master of Science - MS', 'Computer Science', 2010, 2012],
      ['Jabalpur Engineering College', 'Bachelor of Engineering - BE', 'Electronics & Telecommunication', 2006, 2010],
    ],
    grad_year: 2010,
    branch: 'B.E. in Electronics & Telecommunications',
    current: ['Staff Engineer', 'Siemens'],
    about_starts: 'I moved to Germany in 2012',
  },
  {
    name: 'missing sections: only headline and education',
    text: `Sunil Patel
Civil Engineer
Nagpur, Maharashtra, India
Contact info
Education
Jabalpur Engineering College
Bachelor of Engineering - BE, Civil Engineering
1998 - 2002`,
    full_name: 'Sunil Patel',
    headline: 'Civil Engineer',
    city: 'Nagpur',
    country: 'India',
    jobs: [],
    schools: [['Jabalpur Engineering College', 'Bachelor of Engineering - BE', 'Civil Engineering', 1998, 2002]],
    grad_year: 2002,
    branch: 'B.E. in Civil Engineering',
  },
  {
    name: 'LinkedIn Save to PDF text (sidebar first, company above title, full month names)',
    text: `Contact
www.linkedin.com/in/meera-joshi-4a2b (LinkedIn)
Top Skills
Project Management
Structural Engineering
AutoCAD
Languages
Hindi (Native or Bilingual)
English (Full Professional)
Certifications
PMP
Meera Joshi
Senior Project Manager at Shapoorji Pallonji
Mumbai, Maharashtra, India
Summary
Civil engineer with 14 years on bridges and metro projects.
Experience
Shapoorji Pallonji
Senior Project Manager
March 2018 - Present (7 years 9 months)
Mumbai, Maharashtra, India
Afcons Infrastructure
5 years 2 months
Project Engineer
January 2015 - February 2018 (3 years 2 months)
Pune, Maharashtra, India
Site Engineer
December 2012 - December 2014 (2 years 1 month)
Pune, Maharashtra, India
Education
Jabalpur Engineering College
Bachelor of Engineering - BE, Civil Engineering · (2008 - 2012)
Page 1 of 2`,
    full_name: 'Meera Joshi',
    headline: 'Senior Project Manager at Shapoorji Pallonji',
    city: 'Mumbai',
    country: 'India',
    jobs: [
      ['Senior Project Manager', 'Shapoorji Pallonji', 2018, null, true],
      ['Project Engineer', 'Afcons Infrastructure', 2015, 2018, false],
      ['Site Engineer', 'Afcons Infrastructure', 2012, 2014, false],
    ],
    schools: [['Jabalpur Engineering College', 'Bachelor of Engineering - BE', 'Civil Engineering', 2008, 2012]],
    skills: ['Project Management', 'Structural Engineering', 'AutoCAD'],
    grad_year: 2012,
    branch: 'B.E. in Civil Engineering',
    current: ['Senior Project Manager', 'Shapoorji Pallonji'],
    linkedin_url: 'https://www.linkedin.com/in/meera-joshi-4a2b',
    about_starts: 'Civil engineer with 14 years',
  },
  {
    name: 'app share page with Top skills in About and a profile link',
    text: `Karan Malhotra
Founder & CEO at GreenGrid Energy
Indore, Madhya Pradesh, India
500+ connections
Message
More
https://www.linkedin.com/in/karan-malhotra-greengrid
About
We build rooftop solar for small factories.
Top skills
Solar Energy • Entrepreneurship • Power Systems
Experience
Founder & CEO
GreenGrid Energy · Self-employed
Jan 2019 - Present · 6 yrs 11 mos
Indore, Madhya Pradesh, India
Electrical Engineer
NTPC Limited · Full-time
Aug 2011 - Dec 2018 · 7 yrs 5 mos
Education
Jabalpur Engineering College
Bachelor of Engineering - BE, Electrical Engineering
2007 - 2011`,
    full_name: 'Karan Malhotra',
    headline: 'Founder & CEO at GreenGrid Energy',
    city: 'Indore',
    country: 'India',
    jobs: [
      ['Founder & CEO', 'GreenGrid Energy', 2019, null, true],
      ['Electrical Engineer', 'NTPC Limited', 2011, 2018, false],
    ],
    schools: [['Jabalpur Engineering College', 'Bachelor of Engineering - BE', 'Electrical Engineering', 2007, 2011]],
    skills: ['Solar Energy', 'Entrepreneurship', 'Power Systems'],
    grad_year: 2011,
    branch: 'B.E. in Electrical Engineering',
    current: ['Founder & CEO', 'GreenGrid Energy'],
    linkedin_url: 'https://www.linkedin.com/in/karan-malhotra-greengrid',
  },
  {
    name: 'government officer, company without employment type, years only',
    text: `Dr. Anita Chaturvedi
Assistant Professor at Government Engineering College
Rewa, Madhya Pradesh, India
Contact info
Experience
Assistant Professor
Government Engineering College Rewa
2015 - Present
Rewa, Madhya Pradesh, India
Lecturer
Government Polytechnic Sagar
2011 - 2015
Education
Jabalpur Engineering College
Master of Engineering - ME, Power Systems Engineering
2009 - 2011
Rani Durgavati Vishwavidyalaya
Bachelor of Engineering - BE, Electrical
2005 - 2009`,
    full_name: 'Dr. Anita Chaturvedi',
    headline: 'Assistant Professor at Government Engineering College',
    city: 'Rewa',
    country: 'India',
    jobs: [
      ['Assistant Professor', 'Government Engineering College Rewa', 2015, null, true],
      ['Lecturer', 'Government Polytechnic Sagar', 2011, 2015, false],
    ],
    schools: [
      ['Jabalpur Engineering College', 'Master of Engineering - ME', 'Power Systems Engineering', 2009, 2011],
      ['Rani Durgavati Vishwavidyalaya', 'Bachelor of Engineering - BE', 'Electrical', 2005, 2009],
    ],
    grad_year: 2011,
    branch: 'M.E. in Power Systems Engineering',
    current: ['Assistant Professor', 'Government Engineering College Rewa'],
  },
  {
    name: 'two companies without type, one multi-role group in between',
    text: `Sanjay Mishra
Engineering Manager
Hyderabad, Telangana, India
Contact info
Experience
Engineering Manager
Microsoft
Jul 2021 - Present · 4 yrs 5 mos
Hyderabad, Telangana, India
Amazon
Full-time · 5 yrs 6 mos
Senior SDE
Jan 2018 - Jun 2021 · 3 yrs 6 mos
SDE II
Jan 2016 - Dec 2017 · 2 yrs
System Engineer
Wipro
Jun 2013 - Dec 2015 · 2 yrs 7 mos
Education
Jabalpur Engineering College
Bachelor of Engineering - BE, Computer Science and Engineering
2009 - 2013`,
    full_name: 'Sanjay Mishra',
    headline: 'Engineering Manager',
    city: 'Hyderabad',
    country: 'India',
    jobs: [
      ['Engineering Manager', 'Microsoft', 2021, null, true],
      ['Senior SDE', 'Amazon', 2018, 2021, false],
      ['SDE II', 'Amazon', 2016, 2017, false],
      ['System Engineer', 'Wipro', 2013, 2015, false],
    ],
    schools: [['Jabalpur Engineering College', 'Bachelor of Engineering - BE', 'Computer Science and Engineering', 2009, 2013]],
    grad_year: 2013,
    branch: 'B.E. in Computer Science & Engineering',
    current: ['Engineering Manager', 'Microsoft'],
  },
  {
    name: 'Dubai, headline with pipes, Show all noise, mutual connections',
    text: `${NAV}
Faisal Khan  · 3rd
Operations Lead | Oil & Gas | PMP
Dubai, United Arab Emirates
Contact info
Rohan Mehta and 4 other mutual connections
Follow
Message
More
Experience
Operations Lead
ADNOC · Full-time
Show details
Feb 2020 - Present · 5 yrs 10 mos
Abu Dhabi, United Arab Emirates
Show all 6 experiences
Education
Jabalpur Engineering College
Bachelor of Engineering - BE, Mechanical
2004 - 2008
Show all 3 educations`,
    full_name: 'Faisal Khan',
    headline: 'Operations Lead | Oil & Gas | PMP',
    city: 'Dubai',
    country: 'United Arab Emirates',
    jobs: [['Operations Lead', 'ADNOC', 2020, null, true]],
    schools: [['Jabalpur Engineering College', 'Bachelor of Engineering - BE', 'Mechanical', 2004, 2008]],
    grad_year: 2008,
    branch: 'B.E. in Mechanical Engineering',
    current: ['Operations Lead', 'ADNOC'],
  },
  {
    name: 'education without dates, school without keyword, Hindi About text',
    text: `Pooja Rajput
Teacher
Katni, Madhya Pradesh, India
Contact info
About
मैं पिछले दस साल से बच्चों को गणित पढ़ा रही हूँ।
Experience
Teacher
Kendriya Vidyalaya · Full-time
Jul 2014 - Present · 11 yrs 5 mos
Education
Jabalpur Engineering College
Bachelor of Engineering - BE, Information Technology
St. Aloysius
Higher Secondary
2002 - 2004`,
    full_name: 'Pooja Rajput',
    headline: 'Teacher',
    city: 'Katni',
    country: 'India',
    jobs: [['Teacher', 'Kendriya Vidyalaya', 2014, null, true]],
    schools: [
      ['Jabalpur Engineering College', 'Bachelor of Engineering - BE', 'Information Technology', null, null],
      ['St. Aloysius', 'Higher Secondary', null, 2002, 2004],
    ],
    current: ['Teacher', 'Kendriya Vidyalaya'],
    about_starts: 'मैं पिछले',
  },
  {
    name: 'minimal: headline only, no sections',
    text: `Deepak Soni
Mechanical Engineer at Mahindra
Nashik, Maharashtra, India
Contact info
500+ connections`,
    full_name: 'Deepak Soni',
    headline: 'Mechanical Engineer at Mahindra',
    city: 'Nashik',
    country: 'India',
    jobs: [],
    schools: [],
  },
]

/** Text that must never make the parser throw or invent a profile. */
export const JUNK: string[] = [
  '',
  '   \n\n  ',
  'hello',
  '12345',
  '{"a":1}',
  '<html><body>Experience</body></html>',
  'Experience\nExperience\nEducation\nSkills\n',
  'Experience\nJan 2020 - Present\n',
  'Experience\n2020 - 2021\n2019 - 2020\n',
  'Education\n2012 - 2016\n',
  '\u0000\u0001﻿',
  '😀'.repeat(500),
  'x'.repeat(100_000),
  `Experience\n${'Jan 2020 - Present\n'.repeat(500)}`,
  `${'a, b, c, d, e\n'.repeat(3000)}`,
  'लिंक्डइन प्रोफ़ाइल\nअनुभव\nशिक्षा',
]
