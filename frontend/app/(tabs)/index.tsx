import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { globalStyles, colors } from '../../styles/global';
import { Layout } from '../../components/PageContainer';
import { DatabaseViewer } from '@/components/DBViewer';


export default function Home() {
  return (
    <Layout contentStyle={{
      justifyContent: 'flex-start',
      paddingTop: 0, // Remove top padding ('safe zone area, looks ugly when scrolling down)
      paddingBottom: 0,
      borderColor: '#fff',
      borderRadius: '30px',
  }}>
          
          <View style={globalStyles.card}>
            <Text style={globalStyles.title}>Mood Tracker</Text>
            <Text style={{color: colors.text}}>Hello</Text>
          </View>
          <DatabaseViewer />

    </Layout>
  );
}

// export function DatabaseViewer() {
//     const db = useSQLiteContext();
//     const [entries, setEntries] = useState<MoodItem[]>([]);
//     useEffect(() => {
//         async function setup() {
//           const result = await db.getAllAsync<MoodItem>('SELECT * FROM entries');
//           setEntries(result);
//         }
//         setup();
//       }, []);
//       return (
//         <ScrollView style={{paddingBottom: 100, }} showsVerticalScrollIndicator={false}>
//             {entries.map(entry => (
//                 <View key={entry.id} style={globalStyles.card}>
//                     <Text style={{color: colors.text}}>ID: {entry.id}</Text>
//                     <Text style={{color: colors.text}}>Mood Value: {entry.mood}</Text>
//                     <Text style={{color: colors.text}}>Notes: {entry.notes || 'No notes'}</Text>
//                     <Text style={{color: colors.text}}>
//                         Date: {new Date(entry.date).toLocaleString()}
//                     </Text>
//                 </View>
//             ))}
//         </ScrollView>
//     );
// }