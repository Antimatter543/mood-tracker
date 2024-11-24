import { Layout } from "@/components/PageContainer";
import { Text, View, StyleSheet, Button } from "react-native";

export default function AboutScreen() {
    return (
        <Layout>
            <Text style={styles.text}>About MAHasddsa BALLS</Text>
            <View>
                <Button
                    title="Click Me"
                    onPress={handlePress} />
            </View>
        </Layout>
    );
}

// https://medium.com/@yildizfatma/creating-and-validating-forms-in-react-native-expo-a-step-by-step-guide-c0046753eb44
const handlePress = () => {
    alert('Button Pressed');
}


const styles = StyleSheet.create({

    container: {
        flex: 1,
        backgroundColor: '#25292e',
        alignItems: 'center',
        justifyContent: 'center',
    },

    text: {
        color: '#fff',
    },
});