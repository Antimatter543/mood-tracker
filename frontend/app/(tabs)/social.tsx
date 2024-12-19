import { Text, View, StyleSheet, TextInput } from "react-native";
import { useState } from 'react';

export default function Social() {
    const [name, setName] = useState("");
    const [message, setMessage] = useState("");

    return (
        <View style={styles.container}>
            <View style={styles.inputContainer}>
                <Text style={styles.label}>Enter your name:</Text>
                <TextInput
                    style={styles.input}
                    onChangeText={setName}
                    value={name}
                    placeholder="Your name"
                    placeholderTextColor="#666"
                />

                <Text style={styles.label}>Enter a message:</Text>
                <TextInput
                    style={styles.input}
                    onChangeText={setMessage}
                    value={message}
                    placeholder="Type your message"
                    placeholderTextColor="#666"
                    multiline={true}
                    numberOfLines={4}
                />

                <Text style={styles.preview}>
                    {name ? `Name: ${name}` : 'Enter a name above'}
                </Text>
                <Text style={styles.preview}>
                    {message ? `Message: ${message}` : 'Type a message above'}
                </Text>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#25292e',
        alignItems: 'center',
        justifyContent: 'flex-start',
        paddingTop: 40,
    },
    inputContainer: {
        width: '90%',
        padding: 20,
    },
    label: {
        color: '#fff',
        fontSize: 16,
        marginBottom: 5,
        marginTop: 15,
    },
    input: {
        backgroundColor: '#fff',
        borderRadius: 8,
        padding: 10,
        fontSize: 16,
        color: '#000',
        width: '100%',
    },
    preview: {
        color: '#fff',
        marginTop: 20,
        fontSize: 16,
    },
    text: {
        color: '#fff',
    },
});